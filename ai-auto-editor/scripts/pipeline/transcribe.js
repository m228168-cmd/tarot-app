/**
 * transcribe.js
 * Picks the latest 'downloaded' file from processed-log,
 * runs Whisper transcription, saves transcript, updates log.
 *
 * Requires: whisper CLI (`pip install openai-whisper`)
 * or set OPENAI_API_KEY to use OpenAI Whisper API instead.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readProcessedLog, upsertProcessedFile } from './processed-log.js'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const TRANSCRIPT_DIR = path.join(ROOT_DIR, 'downloads', 'transcripts')

async function transcribeWithWhisperCLI(localPath, outputDir) {
  // whisper writes <name>.txt / .json / .srt into outputDir
  const { stdout, stderr } = await execFileAsync('whisper', [
    localPath,
    '--output_dir', outputDir,
    '--output_format', 'json',
    '--language', 'zh',  // change to 'en' or remove for auto-detect
  ], { timeout: 30 * 60 * 1000 }) // 30 min max
  return { stdout, stderr }
}

async function transcribeWithOpenAI(localPath) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  // Dynamically import openai only if needed to avoid hard dependency
  const { default: OpenAI } = await import('openai').catch(() => {
    throw new Error('openai package not installed — run: npm install openai')
  })
  const client = new OpenAI({ apiKey })
  const fileHandle = await import('node:fs').then(m => m.createReadStream(localPath))
  const result = await client.audio.transcriptions.create({
    file: fileHandle,
    model: 'whisper-1',
    response_format: 'verbose_json',
  })
  return result
}

// --- main ---

const log = await readProcessedLog()
const candidate = log.files
  .filter((f) => f.status === 'downloaded')
  .sort((a, b) => new Date(b.downloadedAt) - new Date(a.downloadedAt))[0]

if (!candidate) {
  console.log(JSON.stringify({ ok: true, message: 'No downloaded files pending transcription.' }, null, 2))
  process.exit(0)
}

console.error(`[transcribe] Processing: ${candidate.name} (${candidate.fileId})`)

await fs.mkdir(TRANSCRIPT_DIR, { recursive: true })

const baseName = path.basename(candidate.localPath, path.extname(candidate.localPath))
let transcriptPath
let method

// Try whisper CLI first, fall back to OpenAI API
try {
  await execFileAsync('whisper', ['--version'], { timeout: 5000 })
  console.error('[transcribe] Using local Whisper CLI')
  await transcribeWithWhisperCLI(candidate.localPath, TRANSCRIPT_DIR)
  transcriptPath = path.join(TRANSCRIPT_DIR, `${baseName}.json`)
  method = 'whisper-cli'
} catch (cliErr) {
  if (cliErr.code === 'ENOENT' || cliErr.message.includes('not found')) {
    console.error('[transcribe] whisper CLI not found, trying OpenAI API')
    try {
      const result = await transcribeWithOpenAI(candidate.localPath)
      transcriptPath = path.join(TRANSCRIPT_DIR, `${baseName}.json`)
      await fs.writeFile(transcriptPath, JSON.stringify(result, null, 2))
      method = 'openai-api'
    } catch (apiErr) {
      console.error('[transcribe] OpenAI API also failed:', apiErr.message)
      throw new Error(
        'No transcription backend available.\n' +
        '  Option A: pip install openai-whisper\n' +
        '  Option B: set OPENAI_API_KEY and npm install openai'
      )
    }
  } else {
    throw cliErr
  }
}

await upsertProcessedFile({
  fileId: candidate.fileId,
  status: 'transcribed',
  transcriptPath,
  transcribedAt: new Date().toISOString(),
  transcribeMethod: method,
})

console.log(JSON.stringify({
  ok: true,
  fileId: candidate.fileId,
  name: candidate.name,
  transcriptPath,
  method,
}, null, 2))
