import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export const config = {
  api: {
    bodyParser: false,
  },
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function extractBoundary(contentType = '') {
  const match = contentType.match(/boundary=(.*)$/)
  return match?.[1]
}

function parseMultipart(buffer, boundary) {
  const boundaryText = `--${boundary}`
  const parts = buffer.toString('binary').split(boundaryText).filter((part) => part.includes('filename='))
  if (!parts.length) return null

  const part = parts[0]
  const [rawHeaders, rawBody] = part.split('\r\n\r\n')
  const filenameMatch = rawHeaders.match(/filename="([^"]+)"/)
  const typeMatch = rawHeaders.match(/Content-Type: ([^\r\n]+)/i)
  const fileBinary = rawBody.replace(/\r\n--$/, '')

  return {
    filename: filenameMatch?.[1] || 'upload.bin',
    contentType: typeMatch?.[1] || 'application/octet-stream',
    buffer: Buffer.from(fileBinary, 'binary'),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const contentType = req.headers['content-type'] || ''
  const boundary = extractBoundary(contentType)

  if (!boundary) {
    res.status(400).json({ error: 'Missing multipart boundary' })
    return
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-editor-'))

  try {
    const body = await readRequestBody(req)
    const file = parseMultipart(body, boundary)

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' })
      return
    }

    const inputPath = path.join(tempDir, file.filename)
    const outputDir = path.join(tempDir, 'out')
    await fs.mkdir(outputDir, { recursive: true })
    await fs.writeFile(inputPath, file.buffer)

    await execFileAsync(path.join(process.env.HOME || '', '.venvs/whisper/bin/python'), [
      '-m',
      'whisper',
      inputPath,
      '--language',
      'Chinese',
      '--task',
      'transcribe',
      '--model',
      'tiny',
      '--output_format',
      'json',
      '--output_dir',
      outputDir,
    ])

    const baseName = path.parse(file.filename).name
    const jsonPath = path.join(outputDir, `${baseName}.json`)
    const transcript = JSON.parse(await fs.readFile(jsonPath, 'utf8'))

    res.status(200).json({
      ok: true,
      text: transcript.text,
      segments: transcript.segments || [],
      language: transcript.language,
      filename: file.filename,
    })
  } catch (error) {
    console.error('transcribe failed', error)
    res.status(500).json({ error: 'Transcription failed' })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
