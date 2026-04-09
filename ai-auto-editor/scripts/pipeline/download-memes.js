import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const MEME_DIR = path.join(ROOT, 'assets', 'memes')
const INDEX_PATH = path.join(MEME_DIR, 'index.json')
const SOURCES_PATH = path.join(MEME_DIR, 'sources.json')

async function main() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'))
  const sources = JSON.parse(await fs.readFile(SOURCES_PATH, 'utf8'))
  const sourceMap = new Map((sources.sources || []).map(s => [s.id, s]))

  const result = []
  for (const meme of index.memes || []) {
    const source = sourceMap.get(meme.id)
    if (!source?.url) {
      result.push({ id: meme.id, status: 'skipped', reason: 'missing-url' })
      continue
    }

    const target = path.join(MEME_DIR, meme.file)
    const resp = await fetch(source.url, {
      headers: { 'User-Agent': 'ai-auto-editor meme bootstrap/1.0' },
    })

    if (!resp.ok) {
      result.push({ id: meme.id, status: 'failed', reason: `http-${resp.status}` })
      continue
    }

    const arrayBuffer = await resp.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)
    await fs.writeFile(target, bytes)

    // 清理舊檔只針對「同一 id 但檔名曾與 id 同名」的 legacy case；
    // 若目前 target 本身不是 <id>.<ext> 型式，避免把剛下載的新檔誤刪。
    const legacyLikeNames = new Set(['.png', '.jpg', '.jpeg', '.webp'].map(ext => `${meme.id}${ext}`))
    if (legacyLikeNames.has(path.basename(target))) {
      for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
        const candidate = path.join(MEME_DIR, `${meme.id}${ext}`)
        if (candidate === target) continue
        await fs.rm(candidate, { force: true })
      }
    }

    result.push({ id: meme.id, status: 'downloaded', bytes: bytes.length, file: meme.file })
  }

  console.log(JSON.stringify({ ok: true, result }, null, 2))
}

await main()
