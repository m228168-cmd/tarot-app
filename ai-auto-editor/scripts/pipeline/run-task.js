import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { upsertTask } from './task-state.js'

const [, , taskName, ...commandParts] = process.argv

if (!taskName || commandParts.length === 0) {
  console.error('Usage: node scripts/pipeline/run-task.js <task-name> <command...>')
  process.exit(1)
}

const command = commandParts.join(' ')
const id = crypto.randomUUID()
const startedAt = new Date().toISOString()

await upsertTask({
  id,
  taskName,
  command,
  status: 'running',
  startedAt,
})

console.log(`[task:start] ${taskName}`)
console.log(`[task:id] ${id}`)
console.log(`[task:command] ${command}`)

const child = spawn(command, {
  shell: true,
  stdio: 'inherit',
})

child.on('exit', async (code, signal) => {
  const finishedAt = new Date().toISOString()
  const status = code === 0 ? 'done' : 'failed'
  await upsertTask({
    id,
    taskName,
    command,
    status,
    startedAt,
    finishedAt,
    exitCode: code,
    signal,
  })

  console.log(`[task:${status}] ${taskName}`)
  console.log(`[task:finishedAt] ${finishedAt}`)
  console.log(`[task:exitCode] ${code}`)
  process.exit(code ?? 1)
})
