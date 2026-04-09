import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const MEME_DIR = path.join(ROOT, 'assets', 'memes')
const INDEX_PATH = path.join(MEME_DIR, 'index.json')
const SOURCES_PATH = path.join(MEME_DIR, 'sources.json')

async function validateLibrary() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'))
  const sources = JSON.parse(await fs.readFile(SOURCES_PATH, 'utf8'))
  const sourceMap = new Map((sources.sources || []).map(s => [s.id, s]))

  const rows = []
  for (const meme of index.memes || []) {
    const filePath = path.join(MEME_DIR, meme.file)
    let fileExists = true
    try { await fs.access(filePath) } catch { fileExists = false }
    const source = sourceMap.get(meme.id)
    rows.push({
      id: meme.id,
      file: meme.file,
      safetyTier: meme.safetyTier || 'legacy',
      fileExists,
      sourceStatus: source?.status || 'missing-source-entry',
      hasUrl: Boolean(source?.url),
    })
  }

  return rows
}

const rows = await validateLibrary()
const summary = {
  total: rows.length,
  ready: rows.filter(r => r.fileExists).length,
  safeReady: rows.filter(r => r.fileExists && r.safetyTier === 'safe').length,
  safeMissingFiles: rows.filter(r => !r.fileExists && r.safetyTier === 'safe').map(r => r.id),
  missingFiles: rows.filter(r => !r.fileExists).map(r => r.id),
  withSourceUrls: rows.filter(r => r.hasUrl).map(r => r.id),
  rows,
}

console.log(JSON.stringify(summary, null, 2))
