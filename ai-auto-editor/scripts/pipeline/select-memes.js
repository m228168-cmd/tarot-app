import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const INDEX_PATH = path.join(ROOT, 'assets', 'memes', 'index.json')

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '')
}

function scoreMemeForText(meme, text) {
  const normalized = normalize(text)
  let score = 0
  for (const trigger of meme.triggers || []) {
    if (normalized.includes(normalize(trigger))) score += 3
  }
  for (const tag of meme.tags || []) {
    if (normalized.includes(normalize(tag))) score += 1
  }
  return score
}

export async function loadSafeMemes() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'))
  return (index.memes || []).filter(m => (m.safetyTier || 'legacy') === 'safe')
}

export async function autoSelectMemesForSegments(segments, opts = {}) {
  const safeMemes = await loadSafeMemes()
  const maxSelections = opts.maxSelections || 3
  const minScore = opts.minScore || 3

  const candidates = []
  for (const seg of segments || []) {
    const text = seg.text || seg.originalText || ''
    if (!text.trim()) continue

    for (const meme of safeMemes) {
      const score = scoreMemeForText(meme, text)
      if (score >= minScore) {
        candidates.push({ segId: String(seg.id), memeId: meme.id, score, start: seg.start || 0 })
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.start - b.start)

  const chosenSegs = new Set()
  const chosenMemes = new Set()
  const selections = {}
  for (const c of candidates) {
    if (chosenSegs.has(c.segId)) continue
    if (chosenMemes.has(c.memeId)) continue
    selections[c.segId] = c.memeId
    chosenSegs.add(c.segId)
    chosenMemes.add(c.memeId)
    if (Object.keys(selections).length >= maxSelections) break
  }

  return selections
}
