import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProcessedLog, upsertProcessedFile } from './processed-log.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const ARTIFACT_DIR = path.join(ROOT_DIR, 'downloads', 'artifacts')

function formatTime(seconds) {
  const totalMs = Math.max(0, Math.floor(seconds * 1000))
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function toSrt(segments) {
  return segments.map((seg, index) => {
    const text = (seg.text || '').trim()
    return `${index + 1}\n${formatTime(seg.start || 0)} --> ${formatTime(seg.end || 0)}\n${text}\n`
  }).join('\n')
}

function buildCutSuggestions(segments) {
  const suggestions = []
  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1]
    const curr = segments[i]
    const gap = (curr.start || 0) - (prev.end || 0)
    if (gap >= 1.5) {
      suggestions.push({
        type: 'pause-gap',
        gapSeconds: Number(gap.toFixed(2)),
        afterSegment: i,
        cutAround: Number(prev.end.toFixed(2)),
        reason: '長停頓，可考慮切段或縮短空白',
      })
    }
  }

  const merged = []
  let current = null
  for (const seg of segments) {
    const text = (seg.text || '').trim()
    if (!text) continue
    if (!current) {
      current = { start: seg.start || 0, end: seg.end || 0, texts: [text] }
      continue
    }
    if ((seg.start || 0) - current.end <= 0.8) {
      current.end = seg.end || current.end
      current.texts.push(text)
    } else {
      merged.push(current)
      current = { start: seg.start || 0, end: seg.end || 0, texts: [text] }
    }
  }
  if (current) merged.push(current)

  const highlights = merged
    .map((block) => ({
      start: Number(block.start.toFixed(2)),
      end: Number(block.end.toFixed(2)),
      duration: Number((block.end - block.start).toFixed(2)),
      preview: block.texts.join(' ').slice(0, 120),
    }))
    .filter((block) => block.duration >= 20 && block.duration <= 90)
    .slice(0, 20)

  return { suggestions, highlights }
}

const log = await readProcessedLog()
const candidate = [...log.files]
  .filter((f) => f.status === 'transcribed' && f.transcriptPath)
  .sort((a, b) => new Date(b.transcribedAt) - new Date(a.transcribedAt))[0]

if (!candidate) {
  console.log(JSON.stringify({ ok: true, message: 'No transcribed files available.' }, null, 2))
  process.exit(0)
}

await fs.mkdir(ARTIFACT_DIR, { recursive: true })
const transcript = JSON.parse(await fs.readFile(candidate.transcriptPath, 'utf8'))
const segments = transcript.segments || []
const baseName = path.basename(candidate.transcriptPath, path.extname(candidate.transcriptPath))
const srtPath = path.join(ARTIFACT_DIR, `${baseName}.srt`)
const suggestionsPath = path.join(ARTIFACT_DIR, `${baseName}.cut-suggestions.json`)

await fs.writeFile(srtPath, toSrt(segments))
const suggestionData = buildCutSuggestions(segments)
await fs.writeFile(suggestionsPath, JSON.stringify(suggestionData, null, 2))

await upsertProcessedFile({
  fileId: candidate.fileId,
  subtitlesPath: srtPath,
  cutSuggestionsPath: suggestionsPath,
  artifactedAt: new Date().toISOString(),
})

console.log(JSON.stringify({
  ok: true,
  fileId: candidate.fileId,
  name: candidate.name,
  srtPath,
  suggestionsPath,
  suggestionCount: suggestionData.suggestions.length,
  highlightCount: suggestionData.highlights.length,
}, null, 2))
