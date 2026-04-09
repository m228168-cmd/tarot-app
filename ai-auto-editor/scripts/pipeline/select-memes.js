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

  // 通用情緒 fallback，讓 safe 庫在普通口語字幕也較容易命中
  if (meme.id === 'this-is-fine' && /沒事|正常|還好|崩潰|爆炸|災難|問題/.test(text)) score += 2
  if (meme.id === 'smile-emoji' && /開心|好笑|哈哈|喜歡|不錯|可以|輕鬆/.test(text)) score += 2
  if (meme.id === 'wikipedia-meme' && /查|結果|原來|知識|學到|越看越多|停不下來/.test(text)) score += 2
  if (meme.id === 'krazy-kat-panel' && /荒謬|太扯|奇怪|怪|離譜|像漫畫/.test(text)) score += 2

  return score
}

export async function loadSafeMemes() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'))
  return (index.memes || []).filter(m => (m.safetyTier || 'legacy') === 'safe')
}

export async function autoSelectMemesForSegments(segments, opts = {}) {
  const safeMemes = await loadSafeMemes()
  const maxSelections = opts.maxSelections || 3
  const minScore = opts.minScore || 2

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

  if (!Object.keys(selections).length && (segments || []).length) {
    const fallbackTargets = [
      safeMemes.find(m => m.id === 'this-is-fine'),
      safeMemes.find(m => m.id === 'smile-emoji'),
    ].filter(Boolean)

    for (let i = 0; i < Math.min(fallbackTargets.length, segments.length); i++) {
      const seg = segments[i]
      selections[String(seg.id)] = fallbackTargets[i].id
    }
  }

  return selections
}
