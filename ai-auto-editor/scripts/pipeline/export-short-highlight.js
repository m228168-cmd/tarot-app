/**
 * export-short-highlight.js
 *
 * 輸出短影音精華（< 1 分鐘）
 * - 比例：9:16（1080x1920），手機短影音標準
 * - 字幕：繁體中文，燒進畫面（hardsub），每行最多 13 字，最多 2 行
 * - 流程：選段 → 靜音剪輯 → 裁切 9:16 → 重對齊字幕 → 燒字幕 → 上傳 Drive
 *
 * 使用方式：
 *   node scripts/pipeline/export-short-highlight.js
 *
 * 預設精華段落在 HIGHLIGHT_RANGES 設定（秒），可手動調整或接 AI 選段。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import 'dotenv/config'
import { readProcessedLog, upsertProcessedFile } from './processed-log.js'
import { ensureDriveFolder, uploadFileToDrive } from '../drive/upload-file.js'
import { selectHighlightWithAI } from './select-highlight-ai.js'
import { renderWaveformShort } from './render-waveform-short.js'
import { generateReviewFile } from './review-file.js'
import { autoSelectMemesForSegments } from './select-memes.js'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const EXPORT_DIR = path.join(ROOT_DIR, 'downloads', 'exports')
const SOURCE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '10lnmy_8pCUcTNxaj-_ArND-I9cmvtQ4p'

// ─── 模式設定 ────────────────────────────────────────────────────
// AI_SELECT=true  → 用 GPT-4o 自動選段（需要 OPENAI_API_KEY）
// AI_SELECT=false → 用下方 HIGHLIGHT_RANGES 手動指定
const AI_SELECT = process.env.AI_SELECT !== 'false'

// 手動指定備用（AI_SELECT=false 時使用）
const MANUAL_RANGES = [
  { start: 512, end: 554 },
]
// ────────────────────────────────────────────────────────────────

// 短影音字幕規格（參考 YouTube Shorts 大字幕風格）
const SUBTITLE_SPEC = {
  maxCharsPerLine: 7,    // 每行最多 7 個中文字，字大才夠醒目
  maxLines: 2,           // 最多 2 行
  minDuration: 0.8,      // 最短顯示時間（秒）
  fontSize: 120,         // 大字幕，再大兩級
  fontName: 'PingFang TC',  // 繁體中文，比 STHeiti 更粗更清晰
  marginV: 480,          // 畫面分 10 段，從底部算第 2.5 段（1920/10 × 2.5 = 480）
  outline: 7,            // 粗黑邊（配合字體加大）
  shadow: 2,
}

// 9:16 裁切參數（來源 1280x720 → 中央裁 405x720 → scale 1080x1920）
const CROP_FILTER = 'crop=405:720:438:0,scale=1080:1920'

// ─── 靜音剪輯邏輯（與 rough-cut 相同邏輯）─────────────────────
function buildKeepRanges(segments, highlightStart, highlightEnd) {
  const trimSilenceOver = 2.0
  const keepPadding = 0.3
  const filtered = segments.filter(s =>
    s.end > highlightStart && s.start < highlightEnd && (s.text || '').trim()
  )
  if (!filtered.length) return [{ start: highlightStart, end: highlightEnd }]

  const ranges = []
  for (const seg of filtered) {
    const segStart = Math.max(highlightStart, seg.start)
    const segEnd = Math.min(highlightEnd, seg.end)
    if (!ranges.length) {
      ranges.push({ start: highlightStart, end: segEnd + keepPadding })
      continue
    }
    const prev = ranges[ranges.length - 1]
    const gap = segStart - prev.end
    if (gap > trimSilenceOver) {
      prev.end = Math.min(highlightEnd, prev.end + keepPadding)
      ranges.push({ start: Math.max(highlightStart, segStart - keepPadding), end: Math.min(highlightEnd, segEnd + keepPadding) })
    } else {
      prev.end = Math.min(highlightEnd, segEnd + keepPadding)
    }
  }
  if (ranges.length) {
    ranges[ranges.length - 1].end = Math.min(highlightEnd, ranges[ranges.length - 1].end)
  }
  return ranges.filter(r => r.end - r.start >= 0.5)
}

// ─── 字幕重排 ─────────────────────────────────────────────────
// 回傳 { lines: string (含 \\N 換行), shrink: boolean (是否需要縮小字體) }
function breakChineseText(text, maxChars) {
  text = text.trim()
  if (text.length <= maxChars) return { lines: text, shrink: false }

  // 斷行後第二行只剩 1-2 字 → 不換行，整句縮小字體塞一行
  if (text.length <= maxChars + 2) {
    return { lines: text, shrink: true }
  }

  // 優先在標點符號後斷行
  const punctBreak = /[，。！？、；：]/
  let breakAt = -1
  for (let i = Math.min(maxChars, text.length - 1); i >= Math.floor(maxChars / 2); i--) {
    if (punctBreak.test(text[i])) { breakAt = i + 1; break }
  }
  if (breakAt === -1) breakAt = maxChars

  const line1 = text.slice(0, breakAt).trim()
  const line2 = text.slice(breakAt, breakAt + maxChars).trim()

  // 第二行只剩 1-2 字 → 整句縮小塞一行
  if (line2.length <= 2) {
    return { lines: text.slice(0, maxChars + 2), shrink: true }
  }

  return { lines: line2 ? `${line1}\\N${line2}` : line1, shrink: false }
}

function remapAndResegment(segments, highlightRangesWithOffsets) {
  const { maxCharsPerLine, maxLines, minDuration } = SUBTITLE_SPEC
  const result = []

  for (const { origRange, keepRanges, baseOffset } of highlightRangesWithOffsets) {
    let cumOffset = baseOffset
    for (const range of keepRanges) {
      const dur = range.end - range.start
      const rangeSegs = segments.filter(s =>
        s.end > range.start && s.start < range.end && (s.text || '').trim()
      )
      for (const seg of rangeSegs) {
        const newStart = Math.max(0, seg.start - range.start) + cumOffset
        const newEnd = Math.min(dur, seg.end - range.start) + cumOffset
        if (newEnd - newStart < 0.3) continue
        const text = (seg.text || '').trim()
        if (!text) continue

        const { lines, shrink } = breakChineseText(text, maxCharsPerLine)
        // shrink=true → 用 ASS override 縮小該句字體，避免第二行只有 1-2 字
        const shrinkSize = Math.round(SUBTITLE_SPEC.fontSize * 0.8)
        const displayText = shrink ? `{\\fs${shrinkSize}}${lines}` : lines
        result.push({
          start: newStart,
          end: Math.max(newStart + minDuration, newEnd),
          text: displayText,
        })
      }
      cumOffset += dur
    }
  }
  return result
}

// ─── ASS 字幕產生 ────────────────────────────────────────────
function toAssTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.round((sec % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// hook: 標題文字（null 則不顯示），totalDuration: 影片總秒數
function buildAss(segs, hook = null, totalDuration = 0) {
  const { fontSize, fontName, outline, shadow, marginV } = SUBTITLE_SPEC

  // 標題樣式：大字黃色、畫面上方（Alignment=8 上置中）
  // 第一行大字，第二行縮小兩級（× 0.75），確保放得進去
  const titleFontSize = Math.round(fontSize * 1.15)
  const titleSmallSize = Math.round(titleFontSize * 0.75)
  const titleMarginV = 160

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Default：白字，下方字幕
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,${outline},${shadow},2,20,20,${marginV},1`,
    // Title：黃字，上方標題（Alignment=8 = 上置中）
    `Style: Title,${fontName},${titleFontSize},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,3,0,1,${outline + 1},${shadow},8,30,30,${titleMarginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  // 標題：顯示前 4 秒（或影片一半，取較短）
  const titleEnd = Math.min(4, totalDuration * 0.5)
  let titleEvent = ''
  if (hook && hook.trim()) {
    const hookText = hook.trim()
    if (hookText.length <= 7) {
      // 短標題：一行大字搞定
      titleEvent = `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${hookText}\n`
    } else {
      // 找語意斷點：在標點符號或「的、與、和、是、了」後面斷行
      const breakChars = /[，。！？、的與和是了]/
      let breakIdx = -1
      // 從中間往前找最近的斷點
      const half = Math.ceil(hookText.length / 2)
      for (let i = half; i >= 3; i--) {
        if (breakChars.test(hookText[i - 1])) { breakIdx = i; break }
      }
      // 找不到就從中間往後找
      if (breakIdx === -1) {
        for (let i = half; i < hookText.length - 2; i++) {
          if (breakChars.test(hookText[i])) { breakIdx = i + 1; break }
        }
      }
      // 都找不到就對半切
      if (breakIdx === -1) breakIdx = half

      const line1 = hookText.slice(0, breakIdx)
      const line2 = hookText.slice(breakIdx)
      if (line2) {
        titleEvent = `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${line1}\\N{\\fs${titleSmallSize}}${line2}\n`
      } else {
        titleEvent = `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${line1}\n`
      }
    }
  }

  const subtitleEvents = segs
    .filter(s => s.text)
    .map(s => `Dialogue: 0,${toAssTime(s.start)},${toAssTime(s.end)},Default,,0,0,0,,${s.text}`)
    .join('\n')

  return header + '\n' + titleEvent + subtitleEvents + '\n'
}

// ─── 主流程 ──────────────────────────────────────────────────
const log = await readProcessedLog()
const candidate = [...log.files]
  .filter(f => f.status === 'transcribed' && f.localPath && f.transcriptPath)
  .sort((a, b) => new Date(b.transcribedAt) - new Date(a.transcribedAt))[0]

if (!candidate) {
  console.log(JSON.stringify({ ok: true, message: 'No transcribed source available.' }))
  process.exit(0)
}

const transcript = JSON.parse(await fs.readFile(candidate.transcriptPath, 'utf8'))
const allSegments = transcript.segments || []
const baseName = path.basename(candidate.localPath)

// 資料夾分類：exports/{來源名}/成品 和 半成品
// 從原始檔名取可讀的資料夾名（去掉 fileId 前綴，保留日期和名稱）
const folderName = (candidate.name || baseName)
  .replace(/[/:]/g, '-')
  .replace(/\s+/g, '_')
  .slice(0, 60)
const FINAL_DIR = path.join(EXPORT_DIR, folderName, '成品')
const WIP_DIR = path.join(EXPORT_DIR, folderName, '半成品')
await fs.mkdir(FINAL_DIR, { recursive: true })
await fs.mkdir(WIP_DIR, { recursive: true })

// 視覺模式：video（預設，需要影片來源）| waveform（音波背景，任何來源皆可）
const VISUAL_MODE = process.env.SHORT_VISUAL_MODE || 'video'

// AI 選段 或 手動指定
let highlightRanges
let aiHook = null
let aiBgm = null
if (AI_SELECT && process.env.OPENAI_API_KEY) {
  const aiResult = await selectHighlightWithAI(allSegments)
  highlightRanges = aiResult.ranges
  aiHook = aiResult.hook
  aiBgm = aiResult.bgm || null
} else {
  console.error('[short-highlight] 使用手動指定段落（AI_SELECT=false 或無 API key）')
  highlightRanges = MANUAL_RANGES
}

// 計算各段精華的 keepRanges 和累積 offset
let totalDuration = 0
const rangesWithOffsets = []

for (const hr of highlightRanges) {
  const keepRanges = buildKeepRanges(allSegments, hr.start, hr.end)
  const segDur = keepRanges.reduce((sum, r) => sum + (r.end - r.start), 0)
  rangesWithOffsets.push({ origRange: hr, keepRanges, baseOffset: totalDuration })
  totalDuration += segDur
}

// 如果 GPT 違規超過 60 秒，報錯不輸出，要求重新選段
if (totalDuration > 65) {
  console.error(`[short-highlight] 錯誤：總時長 ${totalDuration.toFixed(1)}s 超過 60 秒限制，重新選段...`)
  // 只保留第一段（最強的那段）
  const first = rangesWithOffsets[0]
  rangesWithOffsets.length = 0
  rangesWithOffsets.push(first)
  totalDuration = first.keepRanges.reduce((sum, r) => sum + (r.end - r.start), 0)
  console.error(`[short-highlight] 自動回退到第 1 段，時長 ${totalDuration.toFixed(1)}s`)
}

console.error(`[short-highlight] 精華總時長: ${totalDuration.toFixed(1)}s (${(totalDuration/60).toFixed(1)} min)`)
if (aiHook) console.error(`[short-highlight] AI 建議標題: ${aiHook}`)

const PINGFANG_DIR = '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData'

// 字幕（兩種模式共用）
const remappedSegs = remapAndResegment(allSegments, rangesWithOffsets)
const autoMemeSelections = await autoSelectMemesForSegments(
  remappedSegs.map((seg, i) => ({ id: i, start: seg.start, end: seg.end, text: (seg.text || '').replace(/\{\\[^}]+\}/g, '').replace(/\\N/g, '') }))
)
const assPath = path.join(WIP_DIR, 'short-highlight.ass')
await fs.writeFile(assPath, buildAss(remappedSegs, aiHook, totalDuration), 'utf8')
console.error(`[short-highlight] ${remappedSegs.length} 條字幕 → ${path.basename(assPath)}`)
if (Object.keys(autoMemeSelections).length) {
  console.error(`[short-highlight] 自動梗圖: ${JSON.stringify(autoMemeSelections)}`)
}

const finalPath = path.join(FINAL_DIR, '短影音-精華.mp4')
const BGM_ASSETS = path.resolve(ROOT_DIR, 'assets', '背景音樂')

// BGM 解析（兩種模式共用）
let bgmPath = null
if (aiBgm) {
  const candidate_bgm = path.join(BGM_ASSETS, aiBgm)
  try { await fs.access(candidate_bgm); bgmPath = candidate_bgm } catch {}
}
if (bgmPath) console.error(`[short-highlight] 背景音樂: ${aiBgm}`)

let mergedAudioPath = null  // 供 review 檔記錄

if (VISUAL_MODE === 'waveform') {
  // ─── 波形模式：音訊剪輯 → 波形背景渲染 ──────────────────
  console.error(`[short-highlight] 模式: waveform`)
  const allClipPaths = []
  let clipIdx = 0
  for (const { keepRanges } of rangesWithOffsets) {
    for (const range of keepRanges) {
      clipIdx++
      const clipPath = path.join(WIP_DIR, `sh-clip-${String(clipIdx).padStart(4, '0')}.mp3`)
      await execFileAsync('ffmpeg', [
        '-y', '-ss', String(range.start), '-to', String(range.end),
        '-i', candidate.localPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k',
        clipPath,
      ], { timeout: 60000 })
      allClipPaths.push(clipPath)
    }
  }

  const concatListPath = path.join(WIP_DIR, 'sh-concat.txt')
  await fs.writeFile(concatListPath, allClipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  const mergedAudio = path.join(WIP_DIR, 'short-highlight.merged.mp3')
  mergedAudioPath = mergedAudio
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', mergedAudio,
  ], { timeout: 60000 })

  await renderWaveformShort({
    voiceAudioPath: mergedAudio,
    assPath,
    fontsDir: PINGFANG_DIR,
    duration: totalDuration,
    outputPath: finalPath,
    bgmPath,
  })
} else {
  // ─── 影片模式（預設）：影片剪輯 → 裁切 9:16 → 燒字幕 ────
  const allClipPaths = []
  let clipIdx = 0
  for (const { keepRanges } of rangesWithOffsets) {
    for (const range of keepRanges) {
      clipIdx++
      const clipPath = path.join(WIP_DIR, `sh-clip-${String(clipIdx).padStart(4, '0')}.mp4`)
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(range.start),
        '-to', String(range.end),
        '-i', candidate.localPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        clipPath,
      ], { timeout: 60 * 60 * 1000 })
      allClipPaths.push(clipPath)
    }
  }

  // Concat
  const concatListPath = path.join(WIP_DIR, 'sh-concat.txt')
  await fs.writeFile(concatListPath, allClipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  const mergedPath = path.join(WIP_DIR, 'short-highlight.raw.mp4')
  await execFileAsync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    mergedPath,
  ], { timeout: 60 * 60 * 1000 })

  // 裁切 9:16
  const croppedPath = path.join(WIP_DIR, 'short-highlight.916.mp4')
  await execFileAsync('ffmpeg', [
    '-y', '-i', mergedPath,
    '-vf', CROP_FILTER,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    croppedPath,
  ], { timeout: 60 * 60 * 1000 })

  if (bgmPath) {
    const fadeOutStart = Math.max(0, totalDuration - 2)
    const audioFilter = [
      `[0:a]dynaudnorm=f=150:g=15:p=0.95,loudnorm=I=-12:TP=-1:LRA=11[voice]`,
      `[1:a]volume=0.10,afade=t=in:d=1,afade=t=out:st=${fadeOutStart.toFixed(1)}:d=2[bgm]`,
      `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[out]`,
    ].join(';')
    await execFileAsync('ffmpeg', [
      '-y', '-i', croppedPath, '-i', bgmPath,
      '-vf', `ass=${assPath}:fontsdir=${PINGFANG_DIR}`,
      '-filter_complex', audioFilter,
      '-map', '0:v', '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      finalPath,
    ], { timeout: 60 * 60 * 1000 })
  } else {
    await execFileAsync('ffmpeg', [
      '-y', '-i', croppedPath,
      '-vf', `ass=${assPath}:fontsdir=${PINGFANG_DIR}`,
      '-af', 'dynaudnorm=f=150:g=15:p=0.95,loudnorm=I=-12:TP=-1:LRA=11',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      finalPath,
    ], { timeout: 60 * 60 * 1000 })
  }
}

// 產生審稿檔（review.json + SRT 備份）
const reviewPath = finalPath.replace(/\.mp4$/, '.review.json')
await generateReviewFile({
  reviewPath,
  title: aiHook,
  bgm: aiBgm,
  duration: totalDuration,
  highlightRanges,
  remappedSegments: remappedSegs,
  source: { fileId: candidate.fileId, name: candidate.name, audioPath: candidate.localPath },
  output: { videoPath: finalPath, mergedAudioPath: mergedAudioPath, assPath },
  memeSelections: autoMemeSelections,
})
console.error(`[short-highlight] 審稿檔 → ${path.basename(reviewPath)}`)

// 上傳 Drive（output/{來源名}/ 資料夾結構，跟本機一致）
const outputFolder = await ensureDriveFolder('output', SOURCE_FOLDER_ID)
const sourceFolder = await ensureDriveFolder(folderName, outputFolder.id)
const uploaded = await uploadFileToDrive(finalPath, sourceFolder.id, 'video/mp4')
// 上傳審稿檔到 Drive（方便手機編輯）
await uploadFileToDrive(reviewPath, sourceFolder.id, 'application/json').catch(err =>
  console.error(`[short-highlight] 審稿檔上傳失敗（非致命）: ${err.message}`)
)

await upsertProcessedFile({
  fileId: candidate.fileId,
  shortHighlightPath: finalPath,
  shortHighlightUploadedFileId: uploaded.id,
  shortHighlightUploadedAt: new Date().toISOString(),
  shortHighlightDuration: totalDuration,
  shortHighlightRanges: highlightRanges,
  shortHighlightHook: aiHook,
})

console.log(JSON.stringify({
  ok: true,
  sourceFileId: candidate.fileId,
  totalDuration: `${totalDuration.toFixed(1)}s`,
  highlightRanges,
  hook: aiHook,
  finalPath,
  uploaded,
}, null, 2))
