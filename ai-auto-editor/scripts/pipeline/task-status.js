import { readTaskState } from './task-state.js'

const state = await readTaskState()
const latest = [...state.tasks].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0]
const active = state.tasks.filter((task) => task.status === 'running')

if (!latest) {
  console.log('目前沒有任務紀錄。')
  process.exit(0)
}

console.log(`最新任務：${latest.taskName}`)
console.log(`狀態：${latest.status}`)
if (latest.summary) console.log(`摘要：${latest.summary}`)
if (latest.note) console.log(`備註：${latest.note}`)
console.log(`開始：${latest.startedAt}`)
if (latest.finishedAt) console.log(`完成：${latest.finishedAt}`)
console.log(`執行中任務數：${active.length}`)
console.log(`目前${active.length === 0 ? '空閒' : '忙碌中'}`)
