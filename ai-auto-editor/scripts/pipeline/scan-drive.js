import { listDriveFiles } from '../drive/list-files.js'
import { readProcessedLog } from './processed-log.js'

function shouldProcess(file, processedMap) {
  const previous = processedMap.get(file.id)
  if (!previous) return true
  return previous.modifiedTime !== file.modifiedTime
}

const files = await listDriveFiles()
const log = await readProcessedLog()
const processedMap = new Map(log.files.map((item) => [item.fileId, item]))

const candidates = files
  .filter((file) => /(audio|video)/.test(file.mimeType || '') || /\.(mp3|mp4|mov|wav)$/i.test(file.name || ''))
  .map((file) => ({
    ...file,
    needsProcessing: shouldProcess(file, processedMap),
  }))

console.log(JSON.stringify(candidates, null, 2))
