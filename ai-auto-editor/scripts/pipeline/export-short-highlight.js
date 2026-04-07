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

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const EXPORT_DIR = path.join(ROOT_DIR, 'downloads', 'exports')
const SOURCE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1iY8c2sEOPrckjnE5eGwoGP-mUJquFVOx'

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
  fontSize: 95,          // 大字幕，佔畫面寬度約 60-70%
  fontName: 'PingFang TC',  // 繁體中文，比 STHeiti 更粗更清晰
  marginV: 220,          // 距底部像素（避開最底邊）
  outline: 6,            // 粗黑邊
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

// ─── 字幕重排（max 13 字/行，max 2 行）───────────────────────
function breakChineseText(text, maxChars) {
  text = text.trim()
  if (text.length <= maxChars) return [text]

  // 優先在標點符號後斷行
  const punctBreak = /[，。！？、；：]/
  let breakAt = -1
  for (let i = Math.min(maxChars, text.length - 1); i >= Math.floor(maxChars / 2); i--) {
    if (punctBreak.test(text[i])) { breakAt = i + 1; break }
  }
  if (breakAt === -1) breakAt = maxChars

  const line1 = text.slice(0, breakAt).trim()
  const line2 = text.slice(breakAt).trim()
  return line2 ? [line1, line2.slice(0, maxChars)] : [line1]
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

        const lines = breakChineseText(text, maxCharsPerLine)
        const displayLines = lines.slice(0, maxLines).join('\\N')
        result.push({
          start: newStart,
          end: Math.max(newStart + minDuration, newEnd),
          text: displayLines,
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

  // 標題樣式：更大字、黃色、畫面上方（Alignment=8 上置中）
  // 最多 8 字一行，超過自動斷行，顯示前 4 秒
  const titleFontSize = Math.round(fontSize * 1.15)  // 比字幕再大一點
  const titleMarginV = 160  // 距頂部 160px

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
    // 超過 8 字自動插入換行
    const hookText = hook.trim()
    const line1 = hookText.slice(0, 8)
    const line2 = hookText.slice(8, 16)
    const displayText = line2 ? `${line1}\\N${line2}` : line1
    titleEvent = `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${displayText}\n`
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

await fs.mkdir(EXPORT_DIR, { recursive: true })

// AI 選段 或 手動指定
let highlightRanges
let aiHook = null
if (AI_SELECT && process.env.OPENAI_API_KEY) {
  const aiResult = await selectHighlightWithAI(allSegments)
  highlightRanges = aiResult.ranges
  aiHook = aiResult.hook
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

console.error(`[short-highlight] 精華總時長: ${totalDuration.toFixed(1)}s (${(totalDuration/60).toFixed(1)} min)`)
if (aiHook) console.error(`[short-highlight] AI 建議標題: ${aiHook}`)

// 剪輯各 keepRange 片段
const allClipPaths = []
let clipIdx = 0

for (const { origRange, keepRanges } of rangesWithOffsets) {
  for (const range of keepRanges) {
    clipIdx++
    const clipPath = path.join(EXPORT_DIR, `${baseName}.sh-clip-${String(clipIdx).padStart(4, '0')}.mp4`)
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
const concatListPath = path.join(EXPORT_DIR, 'sh-concat.txt')
await fs.writeFile(concatListPath, allClipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
const mergedPath = path.join(EXPORT_DIR, `${baseName}.short-highlight.raw.mp4`)
await execFileAsync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0',
  '-i', concatListPath,
  '-c', 'copy',
  mergedPath,
], { timeout: 60 * 60 * 1000 })

// 裁切 9:16
const croppedPath = path.join(EXPORT_DIR, `${baseName}.short-highlight.916.mp4`)
await execFileAsync('ffmpeg', [
  '-y', '-i', mergedPath,
  '-vf', CROP_FILTER,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
  '-c:a', 'copy',
  '-movflags', '+faststart',
  croppedPath,
], { timeout: 60 * 60 * 1000 })

const PINGFANG_DIR = '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData'

// Whisper 原始字幕（實測比 GPT 重寫版更自然，為預設方案）
const remappedSegs = remapAndResegment(allSegments, rangesWithOffsets)
const assPath = path.join(EXPORT_DIR, `${baseName}.short-highlight.ass`)
await fs.writeFile(assPath, buildAss(remappedSegs, aiHook, totalDuration), 'utf8')
console.error(`[short-highlight] ${remappedSegs.length} 條字幕 → ${path.basename(assPath)}`)

const finalPath = path.join(EXPORT_DIR, `${baseName}.short-highlight.hardsub.mp4`)
await execFileAsync('ffmpeg', [
  '-y', '-i', croppedPath,
  '-vf', `ass=${assPath}:fontsdir=${PINGFANG_DIR}`,
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
  '-c:a', 'copy', '-movflags', '+faststart',
  finalPath,
], { timeout: 60 * 60 * 1000 })

// 上傳 Drive
const outputFolder = await ensureDriveFolder('output', SOURCE_FOLDER_ID)
const uploaded = await uploadFileToDrive(finalPath, outputFolder.id, 'video/mp4')

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
