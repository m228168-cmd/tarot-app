import { listDriveFiles } from '../drive/list-files.js'
import { downloadDriveFile } from '../drive/download-file.js'
import { readProcessedLog, upsertProcessedFile } from './processed-log.js'

const files = await listDriveFiles()
const log = await readProcessedLog()
const processedMap = new Map(log.files.map((item) => [item.fileId, item]))

const candidate = files
  .filter((file) => /(audio|video)/.test(file.mimeType || '') || /\.(mp3|mp4|mov|wav)$/i.test(file.name || ''))
  .find((file) => {
    const previous = processedMap.get(file.id)
    return !previous || previous.modifiedTime !== file.modifiedTime
  })

if (!candidate) {
  console.log(JSON.stringify({ ok: true, message: 'No new files to download.' }, null, 2))
  process.exit(0)
}

const outputPath = await downloadDriveFile(candidate.id, candidate.name)
await upsertProcessedFile({
  fileId: candidate.id,
  name: candidate.name,
  modifiedTime: candidate.modifiedTime,
  downloadedAt: new Date().toISOString(),
  localPath: outputPath,
  status: 'downloaded',
})

console.log(JSON.stringify({
  ok: true,
  fileId: candidate.id,
  name: candidate.name,
  outputPath,
}, null, 2))
