import { readProcessedLog } from './processed-log.js'
import { upsertTask } from './task-state.js'

const log = await readProcessedLog()
const latest = [...(log.files || [])]
  .filter((file) => file.downloadedAt)
  .sort((a, b) => (a.downloadedAt < b.downloadedAt ? 1 : -1))[0]

if (!latest) {
  console.log('No processed download log found.')
  process.exit(0)
}

const taskId = `recovered-download-${latest.fileId}`
await upsertTask({
  id: taskId,
  taskName: 'download-latest',
  command: 'npm run pipeline:download-latest',
  summary: '從 processed log 回補最近一次成功下載任務',
  note: latest.name,
  status: 'done',
  startedAt: latest.downloadedAt,
  finishedAt: latest.downloadedAt,
  exitCode: 0,
  signal: null,
})

console.log(`Recovered task for ${latest.name}`)
