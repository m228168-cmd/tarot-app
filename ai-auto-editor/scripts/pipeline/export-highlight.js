import path from 'node:path'
import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readProcessedLog, upsertProcessedFile } from './processed-log.js'
import { ensureDriveFolder, uploadFileToDrive } from '../drive/upload-file.js'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const EXPORT_DIR = path.join(ROOT_DIR, 'downloads', 'exports')
const SOURCE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1iY8c2sEOPrckjnE5eGwoGP-mUJquFVOx'

const log = await readProcessedLog()
const candidate = [...log.files]
  .filter((f) => f.status === 'transcribed' && f.localPath && f.cutSuggestionsPath)
  .sort((a, b) => new Date(b.transcribedAt) - new Date(a.transcribedAt))[0]

if (!candidate) {
  console.log(JSON.stringify({ ok: true, message: 'No transcribed file with cut suggestions available.' }, null, 2))
  process.exit(0)
}

const cutData = JSON.parse(await fs.readFile(candidate.cutSuggestionsPath, 'utf8'))
const highlight = cutData.highlights?.[0]
if (!highlight) {
  console.log(JSON.stringify({ ok: true, message: 'No highlight available.' }, null, 2))
  process.exit(0)
}

await fs.mkdir(EXPORT_DIR, { recursive: true })
const baseName = path.basename(candidate.localPath)
const outputPath = path.join(EXPORT_DIR, `${baseName}.highlight-01.mp4`)

await execFileAsync('ffmpeg', [
  '-y',
  '-ss', String(highlight.start),
  '-to', String(highlight.end),
  '-i', candidate.localPath,
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-c:a', 'aac',
  '-movflags', '+faststart',
  outputPath,
], { timeout: 60 * 60 * 1000 })

const outputFolder = await ensureDriveFolder('output', SOURCE_FOLDER_ID)
const uploaded = await uploadFileToDrive(outputPath, outputFolder.id, 'video/mp4')

await upsertProcessedFile({
  fileId: candidate.fileId,
  outputFolderId: outputFolder.id,
  latestExportPath: outputPath,
  latestExportUploadedFileId: uploaded.id,
  latestExportUploadedAt: new Date().toISOString(),
})

console.log(JSON.stringify({
  ok: true,
  sourceFileId: candidate.fileId,
  outputPath,
  outputFolder,
  uploaded,
  highlight,
}, null, 2))
