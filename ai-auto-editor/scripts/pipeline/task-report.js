import { readTaskState } from './task-state.js'

const state = await readTaskState()
const latest = [...state.tasks].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]

if (!latest) {
  console.log(JSON.stringify({ status: 'idle', message: 'No tasks recorded yet.' }, null, 2))
  process.exit(0)
}

const active = state.tasks.filter((task) => task.status === 'running')

console.log(JSON.stringify({
  latest,
  activeCount: active.length,
  idle: active.length === 0,
}, null, 2))
