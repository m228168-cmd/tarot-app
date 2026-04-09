/**
 * batch-shorts.js
 *
 * 批次處理 Podcast 短影音：
 * 1. 掃描 Drive 資料夾所有 MP3
 * 2. 逐集下載 → 轉錄 → 出 2 支短影音 → 上傳
 * 3. 輸出按集分資料夾
 *
 * 使用方式：
 *   node scripts/pipeline/batch-shorts.js
 *   node scripts/pipeline/batch-shorts.js --limit 3   （只處理前 3 集）
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { google } from 'googleapis'
import 'dotenv/config'
import { authorizeDrive } from '../drive/auth.js'
import { ensureDriveFolder, uploadFileToDrive } from '../drive/upload-file.js'
import { selectHighlightWithAI } from './select-highlight-ai.js'
import { renderWaveformShort } from './render-waveform-short.js'
import { generateReviewFile } from './review-file.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')
const DOWNLOAD_DIR = path.join(ROOT_DIR, 'downloads', 'raw')
const TRANSCRIPT_DIR = path.join(ROOT_DIR, 'downloads', 'transcripts')
const EXPORT_DIR = path.join(ROOT_DIR, 'downloads', 'exports')
const CORRECTIONS_PATH = path.join(ROOT_DIR, 'assets', '字幕修正清單.json')

// Drive 來源
const PODCAST_FOLDER_2026 = '1gpQrrSXnFYbUF5G0rqhwNN8XT-cACPZo'
const PODCAST_ROOT = '10lnmy_8pCUcTNxaj-_ArND-I9cmvtQ4p'

// 短影音設定（跟 export-short-highlight.js 保持一致）
const SUBTITLE_SPEC = {
  maxCharsPerLine: 7,
  fontSize: 120,
  fontName: 'PingFang TC',
  marginV: 480,
  outline: 7,
  shadow: 2,
}

const PINGFANG_DIR = '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData'

const limit = parseInt(process.argv.find(a => a.startsWith('--limit'))?.split('=')[1] || process.argv[process.argv.indexOf('--limit') + 1]) || 999

// ─── 工具函式 ────────────────────────────────────────────────
function toAssTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.round((sec % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function breakChineseText(text, maxChars) {
  text = text.trim()
  if (text.length <= maxChars) return { lines: text, shrink: false }
  if (text.length <= maxChars + 2) return { lines: text, shrink: true }
  const punctBreak = /[，。！？、；：]/
  let breakAt = -1
  for (let i = Math.min(maxChars, text.length - 1); i >= Math.floor(maxChars / 2); i--) {
    if (punctBreak.test(text[i])) { breakAt = i + 1; break }
  }
  if (breakAt === -1) breakAt = maxChars
  const line1 = text.slice(0, breakAt).trim()
  const line2 = text.slice(breakAt, breakAt + maxChars).trim()
  if (line2.length <= 2) return { lines: text.slice(0, maxChars + 2), shrink: true }
  return { lines: line2 ? `${line1}\\N${line2}` : line1, shrink: false }
}

async function loadCorrections() {
  try {
    const data = JSON.parse(await fs.readFile(CORRECTIONS_PATH, 'utf8'))
    return data.corrections || []
  } catch { return [] }
}

function applyCorrections(text, corrections) {
  for (const { wrong, right } of corrections) {
    text = text.replaceAll(wrong, right)
  }
  return text
}

function buildKeepRanges(segments, start, end) {
  const trimSilenceOver = 2.0
  const keepPadding = 0.3
  const filtered = segments.filter(s => s.end > start && s.start < end && (s.text || '').trim())
  if (!filtered.length) return [{ start, end }]
  const ranges = []
  for (const seg of filtered) {
    const segStart = Math.max(start, seg.start)
    const segEnd = Math.min(end, seg.end)
    if (!ranges.length) {
      ranges.push({ start, end: segEnd + keepPadding })
      continue
    }
    const prev = ranges[ranges.length - 1]
    if (segStart - prev.end > trimSilenceOver) {
      prev.end = Math.min(end, prev.end + keepPadding)
      ranges.push({ start: Math.max(start, segStart - keepPadding), end: Math.min(end, segEnd + keepPadding) })
    } else {
      prev.end = Math.min(end, segEnd + keepPadding)
    }
  }
  if (ranges.length) ranges[ranges.length - 1].end = Math.min(end, ranges[ranges.length - 1].end)
  return ranges.filter(r => r.end - r.start >= 0.5)
}

function remapSegments(segments, rangesWithOffsets, corrections) {
  const { maxCharsPerLine, fontSize } = SUBTITLE_SPEC
  const shrinkSize = Math.round(fontSize * 0.8)
  const result = []
  for (const { keepRanges, baseOffset } of rangesWithOffsets) {
    let cumOffset = baseOffset
    for (const range of keepRanges) {
      const dur = range.end - range.start
      const rangeSegs = segments.filter(s => s.end > range.start && s.start < range.end && (s.text || '').trim())
      for (const seg of rangeSegs) {
        const newStart = Math.max(0, seg.start - range.start) + cumOffset
        const newEnd = Math.min(dur, seg.end - range.start) + cumOffset
        if (newEnd - newStart < 0.3) continue
        let text = applyCorrections((seg.text || '').trim(), corrections)
        if (!text) continue
        const { lines, shrink } = breakChineseText(text, maxCharsPerLine)
        result.push({ start: newStart, end: Math.max(newStart + 0.8, newEnd), text: shrink ? `{\\fs${shrinkSize}}${lines}` : lines })
      }
      cumOffset += dur
    }
  }
  return result
}

function buildAss(segs, hook, totalDuration) {
  const { fontSize, fontName, outline, shadow, marginV } = SUBTITLE_SPEC
  const titleFontSize = Math.round(fontSize * 1.15)
  const titleSmallSize = Math.round(titleFontSize * 0.75)
  const titleMarginV = 160

  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,${outline},${shadow},2,20,20,${marginV},1`,
    `Style: Title,${fontName},${titleFontSize},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,3,0,1,${outline + 1},${shadow},8,30,30,${titleMarginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  const titleEnd = Math.min(4, totalDuration * 0.5)
  let titleEvent = ''
  if (hook?.trim()) {
    const h = hook.trim()
    if (h.length <= 7) {
      titleEvent = `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${h}\n`
    } else {
      const breakChars = /[，。！？、的與和是了]/
      let breakIdx = -1
      const half = Math.ceil(h.length / 2)
      for (let i = half; i >= 3; i--) { if (breakChars.test(h[i - 1])) { breakIdx = i; break } }
      if (breakIdx === -1) for (let i = half; i < h.length - 2; i++) { if (breakChars.test(h[i])) { breakIdx = i + 1; break } }
      if (breakIdx === -1) breakIdx = half
      const l1 = h.slice(0, breakIdx), l2 = h.slice(breakIdx)
      titleEvent = l2 ? `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${l1}\\N{\\fs${titleSmallSize}}${l2}\n` : `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${l1}\n`
    }
  }

  const events = segs.filter(s => s.text).map(s => `Dialogue: 0,${toAssTime(s.start)},${toAssTime(s.end)},Default,,0,0,0,,${s.text}`).join('\n')
  return header + '\n' + titleEvent + events + '\n'
}

// ─── 下載 ────────────────────────────────────────────────────
async function downloadFile(drive, fileId, destPath) {
  const dest = (await import('node:fs')).createWriteStream(destPath)
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
  await new Promise((resolve, reject) => { res.data.pipe(dest); dest.on('finish', resolve); dest.on('error', reject) })
}

// ─── 轉錄 ────────────────────────────────────────────────────
async function transcribe(audioPath, outputPath) {
  console.error(`[transcribe] ${path.basename(audioPath)}...`)
  await execFileAsync('/Users/m2281682/Library/Python/3.9/bin/whisper', [
    audioPath, '--model', 'base', '--language', 'zh',
    '--output_format', 'json', '--output_dir', path.dirname(outputPath),
  ], { timeout: 30 * 60 * 1000 })
  // whisper 輸出檔名跟輸入一樣
  const whisperOut = path.join(path.dirname(outputPath), path.basename(audioPath, path.extname(audioPath)) + '.json')
  if (whisperOut !== outputPath) await fs.rename(whisperOut, outputPath)
}

// ─── 產生一支短影音（純音訊用深色背景）─────────────────────────
async function exportOneShort(audioPath, segments, corrections, highlightRanges, hook, bgmFile, outputDir, outputName) {
  const wipDir = path.join(outputDir, '半成品')
  const finalDir = path.join(outputDir, '成品')
  await fs.mkdir(wipDir, { recursive: true })
  await fs.mkdir(finalDir, { recursive: true })

  // keepRanges + offset
  let totalDuration = 0
  const rangesWithOffsets = []
  for (const hr of highlightRanges) {
    const keepRanges = buildKeepRanges(segments, hr.start, hr.end)
    const segDur = keepRanges.reduce((sum, r) => sum + (r.end - r.start), 0)
    if (totalDuration + segDur > 65 && rangesWithOffsets.length > 0) break
    rangesWithOffsets.push({ origRange: hr, keepRanges, baseOffset: totalDuration })
    totalDuration += segDur
  }

  // 剪音訊片段
  const clipPaths = []
  let ci = 0
  for (const { keepRanges } of rangesWithOffsets) {
    for (const r of keepRanges) {
      ci++
      const cp = path.join(wipDir, `clip-${String(ci).padStart(3, '0')}.mp3`)
      await execFileAsync('ffmpeg', ['-y', '-ss', String(r.start), '-to', String(r.end), '-i', audioPath, '-c', 'copy', cp], { timeout: 60000 })
      clipPaths.push(cp)
    }
  }

  // concat 音訊
  const concatFile = path.join(wipDir, `${outputName}-concat.txt`)
  await fs.writeFile(concatFile, clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  const mergedAudio = path.join(wipDir, `${outputName}-merged.mp3`)
  await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', mergedAudio], { timeout: 60000 })

  // 字幕
  const remapped = remapSegments(segments, rangesWithOffsets, corrections)
  const assPath = path.join(wipDir, `${outputName}.ass`)
  await fs.writeFile(assPath, buildAss(remapped, hook, totalDuration), 'utf8')

  // 生成波形背景短影音（波形取人聲原始音軌，不混 BGM）
  const BGM_DIR = path.resolve(ROOT_DIR, 'assets', '背景音樂')
  let bgmPath = null
  if (bgmFile) {
    const bp = path.join(BGM_DIR, bgmFile)
    try { await fs.access(bp); bgmPath = bp } catch {}
  }

  const finalPath = path.join(finalDir, `${outputName}.mp4`)
  await renderWaveformShort({
    voiceAudioPath: mergedAudio,
    assPath,
    fontsDir: PINGFANG_DIR,
    duration: totalDuration,
    outputPath: finalPath,
    bgmPath,
  })

  return { finalPath, totalDuration, hook, remappedSegments: remapped, mergedAudioPath: mergedAudio, assPath, highlightRanges }
}

// ─── 主流程 ──────────────────────────────────────────────────
const auth = await authorizeDrive()
const drive = google.drive({ version: 'v3', auth })

// 掃描所有 MP3
const listRes = await drive.files.list({
  q: `'${PODCAST_FOLDER_2026}' in parents and trashed = false and mimeType contains 'audio'`,
  fields: 'files(id,name,size,modifiedTime)',
  orderBy: 'name',
  pageSize: 100,
})

const episodes = listRes.data.files || []
console.error(`[batch] 找到 ${episodes.length} 集，處理前 ${Math.min(limit, episodes.length)} 集`)

const corrections = await loadCorrections()
await fs.mkdir(DOWNLOAD_DIR, { recursive: true })
await fs.mkdir(TRANSCRIPT_DIR, { recursive: true })

// 雲端 output 資料夾
const outputDriveFolder = await ensureDriveFolder('output', PODCAST_ROOT)

const results = []

for (let ei = 0; ei < Math.min(limit, episodes.length); ei++) {
  const ep = episodes[ei]
  const epName = ep.name.replace(/\.mp3$/i, '').replace(/[/:]/g, '-').slice(0, 60)
  console.error(`\n===== [${ei + 1}/${Math.min(limit, episodes.length)}] ${epName} =====`)

  // 下載
  const audioPath = path.join(DOWNLOAD_DIR, `${ep.id}.mp3`)
  try { await fs.access(audioPath); console.error('[batch] 已下載，跳過') } catch {
    console.error('[batch] 下載中...')
    await downloadFile(drive, ep.id, audioPath)
    console.error(`[batch] 下載完成 (${(parseInt(ep.size) / 1024 / 1024).toFixed(1)}MB)`)
  }

  // 轉錄
  const transcriptPath = path.join(TRANSCRIPT_DIR, `${ep.id}.json`)
  try { await fs.access(transcriptPath); console.error('[batch] 已轉錄，跳過') } catch {
    await transcribe(audioPath, transcriptPath)
    console.error('[batch] 轉錄完成')
  }

  const transcript = JSON.parse(await fs.readFile(transcriptPath, 'utf8'))
  const segments = transcript.segments || []

  // AI 選 2 段精華
  console.error('[batch] AI 選段（第 1 支）...')
  const result1 = await selectHighlightWithAI(segments)

  // 第 2 支：排除第 1 支選過的時間範圍，再選一次
  console.error('[batch] AI 選段（第 2 支）...')
  const usedRanges = result1.ranges
  const filteredSegs = segments.filter(s => {
    return !usedRanges.some(r => s.start >= r.start - 5 && s.end <= r.end + 5)
  })
  const result2 = await selectHighlightWithAI(filteredSegs)

  // 輸出資料夾
  const epExportDir = path.join(EXPORT_DIR, epName)
  const epDriveFolder = await ensureDriveFolder(epName, outputDriveFolder.id)

  // 產生 2 支短影音
  for (const [idx, result] of [[1, result1], [2, result2]]) {
    const outputName = `短影音-${idx}`
    console.error(`[batch] 生成 ${outputName}...`)
    try {
      const out = await exportOneShort(
        audioPath, segments, corrections,
        result.ranges, result.hook, result.bgm,
        epExportDir, outputName
      )
      // 產生審稿檔
      const reviewPath = out.finalPath.replace(/\.mp4$/, '.review.json')
      await generateReviewFile({
        reviewPath,
        title: result.hook,
        bgm: result.bgm,
        duration: out.totalDuration,
        highlightRanges: result.ranges,
        remappedSegments: out.remappedSegments,
        source: { fileId: ep.id, name: ep.name, audioPath },
        output: { videoPath: out.finalPath, mergedAudioPath: out.mergedAudioPath, assPath: out.assPath },
      })
      console.error(`[batch] 審稿檔 → ${path.basename(reviewPath)}`)
      // 上傳影片 + 審稿檔
      const uploaded = await uploadFileToDrive(out.finalPath, epDriveFolder.id, 'video/mp4')
      await uploadFileToDrive(reviewPath, epDriveFolder.id, 'application/json').catch(err =>
        console.error(`[batch] 審稿檔上傳失敗（非致命）: ${err.message}`)
      )
      console.error(`[batch] ${outputName} 完成 → ${uploaded.webViewLink}`)
      results.push({ episode: epName, short: idx, hook: result.hook, duration: out.totalDuration, uploaded: uploaded.id })
    } catch (err) {
      console.error(`[batch] ${outputName} 失敗: ${err.message}`)
      results.push({ episode: epName, short: idx, error: err.message })
    }
  }
}

console.log(JSON.stringify({ ok: true, processed: results.length / 2, results }, null, 2))
