/**
 * meme-overlay.js
 *
 * 從 review.memeSelections 產生 ffmpeg overlay filter。
 * 目標：讓審稿工作台選到的梗圖真正進到 rerun/render 成品。
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const VALID_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function escFilterPath(p) {
  return p.replace(/([\\:';,])/g, '\\$1')
}

function normalizeSegId(value) {
  return String(value ?? '').trim()
}

export async function resolveMemeOverlays({ rootDir, review }) {
  const memeSelections = review?.memeSelections || {}
  const selectionEntries = Object.entries(memeSelections)
  if (!selectionEntries.length) return []

  const indexPath = path.join(rootDir, 'assets', 'memes', 'index.json')
  let memeIndex
  try {
    memeIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'))
  } catch {
    return []
  }

  const memeMap = new Map((memeIndex.memes || []).map(m => [m.id, m]))
  const segmentMap = new Map((review.segments || []).map(seg => [normalizeSegId(seg.id), seg]))
  const memeDir = path.join(rootDir, 'assets', 'memes')
  const overlays = []

  for (const [rawSegId, memeId] of selectionEntries) {
    const segId = normalizeSegId(rawSegId)
    const seg = segmentMap.get(segId)
    const meme = memeMap.get(memeId)
    if (!seg || !meme?.file) continue

    const filePath = path.join(memeDir, meme.file)
    const ext = path.extname(filePath).toLowerCase()
    if (!VALID_EXTS.has(ext)) continue

    try {
      await fs.access(filePath)
    } catch {
      continue
    }

    const start = Math.max(0, Number(seg.start) || 0)
    const end = Math.max(start + 0.1, Number(seg.end) || start + 0.1)
    overlays.push({ segId, memeId, start, end, filePath })
  }

  return overlays.sort((a, b) => a.start - b.start)
}

export function buildMemeOverlayFilter(overlays, { videoInput = '0:v', startIndex = 1 } = {}) {
  if (!overlays.length) {
    return { inputArgs: [], filter: '', outputLabel: videoInput, overlayCount: 0 }
  }

  const inputArgs = []
  const parts = []
  let current = videoInput

  overlays.forEach((overlay, idx) => {
    const inputIdx = startIndex + idx
    const scaledLabel = `meme${idx}`
    const outLabel = idx === overlays.length - 1 ? 'v_meme_out' : `v_meme_${idx}`

    inputArgs.push('-i', overlay.filePath)
    parts.push(
      `[${inputIdx}:v]scale=360:-1:force_original_aspect_ratio=decrease[${scaledLabel}]`,
      `[${current}][${scaledLabel}]overlay=x=W-w-48:y=280:enable='between(t,${overlay.start.toFixed(2)},${overlay.end.toFixed(2)})'[${outLabel}]`
    )
    current = outLabel
  })

  return {
    inputArgs,
    filter: parts.join(';'),
    outputLabel: `[${current}]`,
    overlayCount: overlays.length,
  }
}

export { escFilterPath }
