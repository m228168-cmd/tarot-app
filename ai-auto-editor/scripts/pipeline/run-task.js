import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { upsertTask } from './task-state.js'

const rawArgs = process.argv.slice(2)
const separatorIndex = rawArgs.indexOf('--')
const metaArgs = separatorIndex >= 0 ? rawArgs.slice(0, separatorIndex) : []
const commandParts = separatorIndex >= 0 ? rawArgs.slice(separatorIndex + 1) : rawArgs.slice(1)
const taskName = separatorIndex >= 0 ? rawArgs[0] : rawArgs[0]

if (!taskName || commandParts.length === 0) {
  console.error('Usage: node scripts/pipeline/run-task.js <task-name> [--summary "..."] [--note "..."] -- <command...>')
  process.exit(1)
}

function readFlag(flag) {
  const index = metaArgs.indexOf(flag)
  if (index === -1) return ''
  return metaArgs[index + 1] || ''
}

const summary = readFlag('--summary')
const note = readFlag('--note')
const command = commandParts.join(' ')
const id = crypto.randomUUID()
const startedAt = new Date().toISOString()

await upsertTask({
  id,
  taskName,
  command,
  summary,
  note,
  status: 'running',
  startedAt,
})

console.log(`[task:start] ${taskName}`)
console.log(`[task:id] ${id}`)
if (summary) console.log(`[task:summary] ${summary}`)
if (note) console.log(`[task:note] ${note}`)
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
    summary,
    note,
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
