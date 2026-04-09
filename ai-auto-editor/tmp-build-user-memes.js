import fs from 'node:fs/promises'
import path from 'node:path'

const memeDir = path.resolve('assets/memes')
const indexPath = path.join(memeDir, 'index.json')
const sourcesPath = path.join(memeDir, 'sources.json')

const skip = new Set(['README.md', 'index.json', 'schema.json', 'sources.json', '.DS_Store'])
const files = (await fs.readdir(memeDir)).filter(name => !skip.has(name))

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[:：]/g, ' ')
    .replace(/[()（）]/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function inferMood(words) {
  const map = {
    '驚訝': 'surprised', '嚇到': 'surprised', '震驚': 'shock', '錯愕': 'shock',
    '無言': 'speechless', '傻眼': 'speechless', '困惑': 'confused', '問號': 'confused',
    '難過': 'sad', '委屈': 'sad', '崩潰': 'meltdown', '爆哭': 'meltdown',
    '開心': 'happy', '慶祝': 'happy', '成功': 'success', '勝利': 'success',
    '懷疑': 'skeptical', '不屑': 'skeptical', '生氣': 'angry', '怒視': 'angry',
    '看戲': 'popcorn', '吃瓜': 'popcorn', '尷尬': 'awkward', '心虛': 'awkward',
    '自信': 'confident', '強勢': 'confident', '空虛': 'void', '絕望': 'void',
  }
  return [...new Set(words.map(w => map[w]).filter(Boolean))]
}

const usedIds = new Map()
function uniqueId(base, triggers) {
  const id = slugify(base)
  if (!usedIds.has(id)) {
    usedIds.set(id, 1)
    return id
  }

  const suffixBase = slugify((triggers || []).slice(0, 2).join('-')) || 'alt'
  let candidate = `${id}-${suffixBase}`
  let n = 2
  while (usedIds.has(candidate)) {
    candidate = `${id}-${suffixBase}-${n}`
    n += 1
  }
  usedIds.set(candidate, 1)
  return candidate
}

const memes = files.map(file => {
  const ext = path.extname(file)
  const raw = path.basename(file, ext)
  const parts = raw.split(' - ')
  const label = parts[0].trim()
  const triggers = (parts[1] || '')
    .split('、')
    .map(s => s.trim())
    .filter(Boolean)

  return {
    id: uniqueId(label, triggers),
    file,
    label,
    tags: ['user', 'custom', ...triggers.slice(0, 2)],
    moods: inferMood(triggers),
    triggers,
    aspectRatio: 'auto',
    source: 'user-provided',
    license: 'user-provided',
    safetyTier: 'safe',
  }
})

const sources = memes.map(m => ({
  id: m.id,
  url: '',
  status: 'user-provided',
  notes: '由使用者手動放入 assets/memes',
  license: 'user-provided',
}))

await fs.writeFile(indexPath, JSON.stringify({
  $schema: './schema.json',
  version: '1.0.0',
  description: '梗圖素材庫 — 供自動剪片依對話內容挑圖使用',
  updated: new Date().toISOString().slice(0, 10),
  memes,
}, null, 2), 'utf8')

await fs.writeFile(sourcesPath, JSON.stringify({
  $schema: './schema.json',
  version: '1.0.0',
  updated: new Date().toISOString().slice(0, 10),
  notes: '由使用者自行放入迷因素材；metadata 依檔名自動產生。',
  sources,
}, null, 2), 'utf8')

console.log(JSON.stringify({ ok: true, count: memes.length, ids: memes.map(m => m.id) }, null, 2))
