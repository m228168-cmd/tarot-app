import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readProcessedLog, upsertProcessedFile } from './processed-log.js'
import { ensureDriveFolder, uploadFileToDrive } from '../drive/upload-file.js'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const EXPORT_DIR = path.join(ROOT_DIR, 'downloads', 'exports')
const SOURCE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1iY8c2sEOPrckjnE5eGwoGP-mUJquFVOx'

function buildKeepRanges(segments, sourceDuration = 0) {
  const ranges = []
  const trimSilenceOver = 3.5
  const keepSilencePadding = 0.45

  if (!segments.length) return ranges

  let cursor = 0
  for (const seg of segments) {
    const text = (seg.text || '').trim()
    if (!text) continue
    const segStart = seg.start || 0
    const segEnd = seg.end || 0

    if (ranges.length === 0) {
      ranges.push({ start: 0, end: segEnd + keepSilencePadding })
      cursor = segEnd
      continue
    }

    const prev = ranges[ranges.length - 1]
    const gap = segStart - prev.end

    if (gap > trimSilenceOver) {
      prev.end = Math.max(prev.start, prev.end + keepSilencePadding)
      ranges.push({ start: Math.max(0, segStart - keepSilencePadding), end: segEnd + keepSilencePadding })
    } else {
      prev.end = segEnd + keepSilencePadding
    }

    cursor = segEnd
  }

  if (ranges.length && sourceDuration > 0) {
    ranges[ranges.length - 1].end = Math.min(sourceDuration, ranges[ranges.length - 1].end)
  }

  return ranges
    .map((r) => ({ start: Number(r.start.toFixed(3)), end: Number(r.end.toFixed(3)) }))
    .filter((r) => r.end - r.start >= 1.5)
}

async function getDuration(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ])
  return Number(stdout.trim())
}

async function writeConcatList(clips) {
  const lines = clips.map((clip) => `file '${clip.replace(/'/g, `'\\''`)}'`).join('\n')
  const concatPath = path.join(EXPORT_DIR, 'rough-cut-concat.txt')
  await fs.writeFile(concatPath, lines)
  return concatPath
}

const log = await readProcessedLog()
const candidate = [...log.files]
  .filter((f) => f.status === 'transcribed' && f.localPath && f.transcriptPath && f.subtitlesPath)
  .sort((a, b) => new Date(b.transcribedAt) - new Date(a.transcribedAt))[0]

if (!candidate) {
  console.log(JSON.stringify({ ok: true, message: 'No transcribed source available.' }, null, 2))
  process.exit(0)
}

const transcript = JSON.parse(await fs.readFile(candidate.transcriptPath, 'utf8'))
const segments = transcript.segments || []
const sourceDuration = await getDuration(candidate.localPath)
const keepRanges = buildKeepRanges(segments, sourceDuration)

await fs.mkdir(EXPORT_DIR, { recursive: true })
const clipPaths = []
const baseName = path.basename(candidate.localPath)

for (let i = 0; i < keepRanges.length; i += 1) {
  const range = keepRanges[i]
  const clipPath = path.join(EXPORT_DIR, `${baseName}.smart-clip-${String(i + 1).padStart(4, '0')}.mp4`)
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(range.start),
    '-to', String(range.end),
    '-i', candidate.localPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    clipPath,
  ], { timeout: 60 * 60 * 1000 })
  clipPaths.push(clipPath)
}

const concatPath = await writeConcatList(clipPaths)
const mergedPath = path.join(EXPORT_DIR, `${baseName}.rough-cut.smart.mp4`)
try {
  await fs.access(mergedPath)
  console.error(`[rough-cut] Reusing existing merged file: ${mergedPath}`)
} catch {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatPath,
    '-c', 'copy',
    mergedPath,
  ], { timeout: 60 * 60 * 1000 })
}

const subtitledPath = path.join(EXPORT_DIR, `${baseName}.rough-cut.smart.softsub.mp4`)
await execFileAsync('ffmpeg', [
  '-y',
  '-i', mergedPath,
  '-i', candidate.subtitlesPath,
  '-map', '0:v',
  '-map', '0:a',
  '-map', '1:0',
  '-c:v', 'copy',
  '-c:a', 'copy',
  '-c:s', 'mov_text',
  '-movflags', '+faststart',
  subtitledPath,
], { timeout: 60 * 60 * 1000 })

const outputFolder = await ensureDriveFolder('output', SOURCE_FOLDER_ID)
const uploaded = await uploadFileToDrive(subtitledPath, outputFolder.id, 'video/mp4')

await upsertProcessedFile({
  fileId: candidate.fileId,
  roughCutPath: mergedPath,
  roughCutSubtitledPath: subtitledPath,
  outputFolderId: outputFolder.id,
  roughCutUploadedFileId: uploaded.id,
  roughCutUploadedAt: new Date().toISOString(),
  roughCutKeepRangeCount: keepRanges.length,
})

console.log(JSON.stringify({
  ok: true,
  sourceFileId: candidate.fileId,
  keepRangeCount: keepRanges.length,
  mergedPath,
  subtitledPath,
  subtitleMode: 'softsub-mp4',
  uploaded,
}, null, 2))
