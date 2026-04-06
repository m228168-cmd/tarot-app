import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const DATA_DIR = path.join(ROOT_DIR, 'data')
const STATE_PATH = path.join(DATA_DIR, 'task-state.json')

export async function readTaskState() {
  try {
    const content = await fs.readFile(STATE_PATH, 'utf8')
    return JSON.parse(content)
  } catch {
    return { tasks: [] }
  }
}

export async function writeTaskState(data) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(STATE_PATH, JSON.stringify(data, null, 2))
}

export async function upsertTask(task) {
  const state = await readTaskState()
  const index = state.tasks.findIndex((item) => item.id === task.id)
  if (index >= 0) {
    state.tasks[index] = { ...state.tasks[index], ...task }
  } else {
    state.tasks.push(task)
  }
  await writeTaskState(state)
  return task
}
