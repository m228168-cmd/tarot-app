/**
 * review-file.js
 *
 * 審稿檔（review.json）產生與讀取模組。
 *
 * 用途：
 *   - 短影音輸出後自動產生 review.json，包含標題 + 逐句字幕
 *   - 手機上可直接編輯 review.json（改 title、改 segments[].text）
 *   - 重跑時讀取 review.json 作為 override layer，覆蓋原始 AI 結果
 *
 * 格式：
 *   {
 *     version: 1,
 *     createdAt, updatedAt,
 *     source: { fileId, name, audioPath },
 *     title,               // 可編輯標題（hook）
 *     bgm,                 // BGM 檔名（可選）
 *     duration,            // 影片總秒數
 *     highlightRanges,     // AI 選段原始範圍
 *     segments: [{ id, start, end, originalText, text }],
 *     memeSelections: { [segmentId]: memeId },
 *     output: { videoPath, mergedAudioPath, assPath }
 *   }
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 產生 review.json 並寫入磁碟
 *
 * @param {object} opts
 * @param {string} opts.reviewPath        review.json 輸出路徑
 * @param {string} opts.title             標題（hook）
 * @param {string|null} opts.bgm          BGM 檔名
 * @param {number} opts.duration          影片總秒數
 * @param {Array} opts.highlightRanges    AI 選段範圍
 * @param {Array} opts.remappedSegments   重排後的字幕段（含 start, end, text）
 * @param {object} opts.source            來源資訊 { fileId, name, audioPath }
 * @param {object} opts.output            輸出路徑 { videoPath, mergedAudioPath, assPath }
 * @param {object} [opts.memeSelections]  梗圖選擇 { [segmentId]: memeId }
 * @returns {Promise<object>} review data
 */
export async function generateReviewFile(opts) {
  const {
    reviewPath, title, bgm, duration,
    highlightRanges, remappedSegments,
    source, output, memeSelections,
  } = opts

  const segments = remappedSegments.map((seg, i) => {
    // 去掉 ASS override tag（如 {\fs96}）還原純文字
    const cleanText = (seg.text || '').replace(/\{\\[^}]+\}/g, '').replace(/\\N/g, '\n')
    return {
      id: i,
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
      originalText: cleanText,
      text: cleanText,
    }
  })

  const review = {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source,
    title: title || '',
    bgm: bgm || null,
    duration: Math.round(duration * 100) / 100,
    highlightRanges,
    segments,
    memeSelections: memeSelections || {},
    output,
  }

  await fs.writeFile(reviewPath, JSON.stringify(review, null, 2), 'utf8')

  // 同時輸出 SRT 作人類可讀備份
  const srtPath = reviewPath.replace(/\.json$/, '.srt')
  await writeSrt(srtPath, segments, title)

  return review
}

/**
 * 讀取 review.json
 */
export async function readReviewFile(reviewPath) {
  const content = await fs.readFile(reviewPath, 'utf8')
  return JSON.parse(content)
}

/**
 * 從 review 資料重建 ASS 字幕內容（使用 review 裡的 text 欄位）
 *
 * @param {object} review    review.json 資料
 * @param {object} subtitleSpec  字幕規格 { fontSize, fontName, marginV, outline, shadow, maxCharsPerLine }
 * @returns {string} ASS 內容
 */
export function buildAssFromReview(review, subtitleSpec) {
  const { fontSize, fontName, marginV, outline, shadow, maxCharsPerLine } = subtitleSpec
  const titleFontSize = Math.round(fontSize * 1.15)
  const titleSmallSize = Math.round(titleFontSize * 0.75)
  const titleMarginV = 160
  const shrinkSize = Math.round(fontSize * 0.8)

  const header = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,${outline},${shadow},2,20,20,${marginV},1`,
    `Style: Title,${fontName},${titleFontSize},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,3,0,1,${outline + 1},${shadow},8,30,30,${titleMarginV},1`,
    '', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  // 標題
  const titleEnd = Math.min(4, review.duration * 0.5)
  let titleEvent = ''
  const hook = (review.title || '').trim()
  if (hook) {
    if (hook.length <= 7) {
      titleEvent = `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${hook}\n`
    } else {
      const breakChars = /[，。！？、的與和是了]/
      let breakIdx = -1
      const half = Math.ceil(hook.length / 2)
      for (let i = half; i >= 3; i--) { if (breakChars.test(hook[i - 1])) { breakIdx = i; break } }
      if (breakIdx === -1) for (let i = half; i < hook.length - 2; i++) { if (breakChars.test(hook[i])) { breakIdx = i + 1; break } }
      if (breakIdx === -1) breakIdx = half
      const l1 = hook.slice(0, breakIdx), l2 = hook.slice(breakIdx)
      titleEvent = l2
        ? `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${l1}\\N{\\fs${titleSmallSize}}${l2}\n`
        : `Dialogue: 0,${toAssTime(0)},${toAssTime(titleEnd)},Title,,0,0,0,,${l1}\n`
    }
  }

  // 字幕事件
  const events = review.segments
    .filter(s => s.text?.trim())
    .map(s => {
      const raw = s.text.trim().replace(/\n/g, '')  // 移除手動換行，重新排版
      const { lines, shrink } = breakChineseTextForAss(raw, maxCharsPerLine)
      const displayText = shrink ? `{\\fs${shrinkSize}}${lines}` : lines
      return `Dialogue: 0,${toAssTime(s.start)},${toAssTime(s.end)},Default,,0,0,0,,${displayText}`
    })
    .join('\n')

  return header + '\n' + titleEvent + events + '\n'
}

// ─── 內部工具 ────────────────────────────────────────────────

function toAssTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.round((sec % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function breakChineseTextForAss(text, maxChars) {
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

function formatSrtTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

async function writeSrt(srtPath, segments, title) {
  const lines = []
  let idx = 1
  if (title?.trim()) {
    lines.push(`${idx}`, `${formatSrtTime(0)} --> ${formatSrtTime(Math.min(4, 30))}`, `【${title.trim()}】`, '')
    idx++
  }
  for (const seg of segments) {
    if (!seg.text?.trim()) continue
    lines.push(`${idx}`, `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}`, seg.text.trim(), '')
    idx++
  }
  await fs.writeFile(srtPath, lines.join('\n'), 'utf8')
}
