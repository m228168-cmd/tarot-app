/**
 * rerun-from-review.js
 *
 * 從 review.json 重跑短影音渲染。
 * 讀取 review 檔中的 title + segments 作為 override layer，
 * 重建字幕並用既有的 merged audio 重新渲染影片。
 *
 * 使用方式：
 *   node scripts/pipeline/rerun-from-review.js <review.json 路徑>
 *   node scripts/pipeline/rerun-from-review.js downloads/exports/EP01/成品/短影音-1.review.json
 *
 * 可選環境變數：
 *   SKIP_UPLOAD=true   跳過 Drive 上傳（本機測試用）
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import { readReviewFile, buildAssFromReview } from './review-file.js'
import { renderWaveformShort } from './render-waveform-short.js'
import { resolveMemeOverlays } from './meme-overlay.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')

const SUBTITLE_SPEC = {
  maxCharsPerLine: 7,
  fontSize: 120,
  fontName: 'PingFang TC',
  marginV: 480,
  outline: 7,
  shadow: 2,
}

const PINGFANG_DIR = '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData'
const BGM_DIR = path.resolve(ROOT_DIR, 'assets', '背景音樂')

// ─── 主流程 ──────────────────────────────────────────────────
const reviewPath = process.argv[2]
if (!reviewPath) {
  console.error('用法: node scripts/pipeline/rerun-from-review.js <review.json 路徑>')
  console.error('範例: node scripts/pipeline/rerun-from-review.js downloads/exports/EP01/成品/短影音-1.review.json')
  process.exit(1)
}

const absReviewPath = path.isAbsolute(reviewPath) ? reviewPath : path.resolve(process.cwd(), reviewPath)

console.error(`[rerun] 讀取審稿檔: ${absReviewPath}`)
const review = await readReviewFile(absReviewPath)

if (review.version !== 1) {
  console.error(`[rerun] 不支援的 review 版本: ${review.version}`)
  process.exit(1)
}

// 檢查 merged audio 存在
const mergedAudioPath = review.output?.mergedAudioPath
if (!mergedAudioPath) {
  console.error('[rerun] review.json 缺少 output.mergedAudioPath')
  process.exit(1)
}
try {
  await fs.access(mergedAudioPath)
} catch {
  console.error(`[rerun] merged audio 不存在: ${mergedAudioPath}`)
  console.error('[rerun] 提示：需要先跑過一次完整 pipeline 產生音訊剪輯')
  process.exit(1)
}

// 從 review 重建 ASS 字幕
console.error(`[rerun] 標題: ${review.title || '(無)'}`)
console.error(`[rerun] 字幕段數: ${review.segments.length}`)

const assContent = buildAssFromReview(review, SUBTITLE_SPEC)
const assPath = review.output?.assPath || path.join(path.dirname(absReviewPath), '..', '半成品', 'rerun.ass')
await fs.mkdir(path.dirname(assPath), { recursive: true })
await fs.writeFile(assPath, assContent, 'utf8')
console.error(`[rerun] 字幕已重建: ${assPath}`)

// BGM
let bgmPath = null
if (review.bgm) {
  const bp = path.join(BGM_DIR, review.bgm)
  try { await fs.access(bp); bgmPath = bp } catch {}
}

// 梗圖 overlays
const memeOverlays = await resolveMemeOverlays({ rootDir: ROOT_DIR, review })
if (memeOverlays.length) {
  console.error(`[rerun] 梗圖 overlays: ${memeOverlays.length} 個`)
}

// 輸出路徑（覆蓋原本成品）
const videoPath = review.output?.videoPath
if (!videoPath) {
  console.error('[rerun] review.json 缺少 output.videoPath')
  process.exit(1)
}
await fs.mkdir(path.dirname(videoPath), { recursive: true })

console.error(`[rerun] 重新渲染中... → ${videoPath}`)
await renderWaveformShort({
  voiceAudioPath: mergedAudioPath,
  assPath,
  fontsDir: PINGFANG_DIR,
  duration: review.duration,
  outputPath: videoPath,
  bgmPath,
  memeOverlays,
})

console.error(`[rerun] 渲染完成!`)

// 更新 review.json 的 updatedAt
review.updatedAt = new Date().toISOString()
await fs.writeFile(absReviewPath, JSON.stringify(review, null, 2), 'utf8')

// 上傳 Drive（可選）
const skipUpload = process.env.SKIP_UPLOAD === 'true'
let uploaded = null
if (!skipUpload) {
  try {
    const { ensureDriveFolder, uploadFileToDrive } = await import('../drive/upload-file.js')

    const SOURCE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '10lnmy_8pCUcTNxaj-_ArND-I9cmvtQ4p'
    // 從 videoPath 推算資料夾名（exports/{folderName}/成品/xxx.mp4）
    const exportDir = path.dirname(path.dirname(videoPath))
    const folderName = path.basename(exportDir)

    const outputFolder = await ensureDriveFolder('output', SOURCE_FOLDER_ID)
    const sourceFolder = await ensureDriveFolder(folderName, outputFolder.id)
    uploaded = await uploadFileToDrive(videoPath, sourceFolder.id, 'video/mp4')
    console.error(`[rerun] 已上傳 Drive: ${uploaded.webViewLink}`)
  } catch (err) {
    console.error(`[rerun] Drive 上傳失敗（非致命）: ${err.message}`)
    console.error('[rerun] 提示：設定 SKIP_UPLOAD=true 可跳過上傳')
  }
}

console.log(JSON.stringify({
  ok: true,
  reviewPath: absReviewPath,
  title: review.title,
  segmentCount: review.segments.length,
  duration: `${review.duration.toFixed(1)}s`,
  videoPath,
  uploaded: uploaded?.id || null,
}, null, 2))
