import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const LOG_PATH = path.join(DATA_DIR, 'processed-files.json')

export async function readProcessedLog() {
  try {
    const content = await fs.readFile(LOG_PATH, 'utf8')
    return JSON.parse(content)
  } catch {
    return { files: [] }
  }
}

export async function writeProcessedLog(data) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(LOG_PATH, JSON.stringify(data, null, 2))
}

export async function upsertProcessedFile(entry) {
  const log = await readProcessedLog()
  const index = log.files.findIndex((item) => item.fileId === entry.fileId)
  if (index >= 0) {
    log.files[index] = { ...log.files[index], ...entry }
  } else {
    log.files.push(entry)
  }
  await writeProcessedLog(log)
  return log
}
