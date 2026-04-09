/**
 * vite-plugin-review-api.js
 *
 * Vite dev server middleware：提供審稿工作台所需的本地 API。
 * 路由：
 *   GET  /api/review/list          列出所有 review.json
 *   GET  /api/review/load?path=    讀取單一 review.json
 *   POST /api/review/save          儲存 review（不觸發 rerun）
 *   POST /api/review/recommend-memes 以 pipeline 同源規則重算梗圖推薦
 *   GET  /api/review/memes         梗圖庫 index
 *   GET  /api/review/corrections   字幕修正清單
 *   POST /api/review/submit        送出：儲存 + 寫入勾選的修正 + 可選 rerun
 *   GET  /media/*                  本地媒體檔案串流（支援 Range seek）
 */

import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { autoSelectMemesForSegments } from './scripts/pipeline/select-memes.js'

const ROOT = process.cwd()

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function findReviewFiles() {
  const exportsDir = path.join(ROOT, 'downloads', 'exports')
  const results = []
  async function walk(dir) {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.endsWith('.review.json')) results.push(path.relative(ROOT, full))
    }
  }
  await walk(exportsDir)
  return results
}

const MIME = {
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg',
}

export default function reviewApiPlugin() {
  return {
    name: 'review-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')

        // ── 媒體檔案串流（支援 Range） ──────────────────────
        if (url.pathname.startsWith('/media/')) {
          const relPath = decodeURIComponent(url.pathname.slice(7))
          const filePath = path.join(ROOT, relPath)
          let stat
          try { stat = await fs.stat(filePath) } catch {
            res.writeHead(404); res.end('Not found'); return
          }
          const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
          const range = req.headers.range
          if (range) {
            const parts = range.replace(/bytes=/, '').split('-')
            const start = parseInt(parts[0], 10)
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
            res.writeHead(206, {
              'Content-Type': mime,
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': end - start + 1,
            })
            createReadStream(filePath, { start, end }).pipe(res)
          } else {
            res.writeHead(200, {
              'Content-Type': mime,
              'Content-Length': stat.size,
              'Accept-Ranges': 'bytes',
            })
            createReadStream(filePath).pipe(res)
          }
          return
        }

        // ── API 路由 ────────────────────────────────────────
        if (!url.pathname.startsWith('/api/review/')) return next()
        const route = url.pathname.slice('/api/review/'.length)

        try {
          // 列出 review 檔
          if (route === 'list' && req.method === 'GET') {
            const files = await findReviewFiles()
            return json(res, { files })
          }

          // 讀取 review
          if (route === 'load' && req.method === 'GET') {
            const p = url.searchParams.get('path')
            if (!p) return json(res, { error: 'missing path' }, 400)
            const abs = path.resolve(ROOT, p)
            const content = JSON.parse(await fs.readFile(abs, 'utf8'))
            return json(res, content)
          }

          // 梗圖重新推薦（與 pipeline 共用同一套 selector）
          if (route === 'recommend-memes' && req.method === 'POST') {
            const body = await readBody(req)
            const selections = await autoSelectMemesForSegments(body.segments || [])
            return json(res, { memeSelections: selections })
          }

          // 梗圖庫
          if (route === 'memes' && req.method === 'GET') {
            const data = JSON.parse(await fs.readFile(path.join(ROOT, 'assets/memes/index.json'), 'utf8'))
            return json(res, data)
          }

          // 字幕修正清單
          if (route === 'corrections' && req.method === 'GET') {
            const data = JSON.parse(await fs.readFile(path.join(ROOT, 'assets/字幕修正清單.json'), 'utf8'))
            return json(res, data)
          }

          // 儲存（不觸發 rerun）
          if (route === 'save' && req.method === 'POST') {
            const body = await readBody(req)
            const abs = path.resolve(ROOT, body.path)
            const review = JSON.parse(await fs.readFile(abs, 'utf8'))
            review.title = body.title
            review.segments = body.segments
            if (body.memeSelections) review.memeSelections = body.memeSelections
            review.updatedAt = new Date().toISOString()
            await fs.writeFile(abs, JSON.stringify(review, null, 2), 'utf8')
            return json(res, { ok: true })
          }

          // 一鍵送出
          if (route === 'submit' && req.method === 'POST') {
            const body = await readBody(req)
            const abs = path.resolve(ROOT, body.path)

            // 1) 寫入 review.json
            const review = JSON.parse(await fs.readFile(abs, 'utf8'))
            review.title = body.title
            review.segments = body.segments
            if (body.memeSelections) review.memeSelections = body.memeSelections
            review.updatedAt = new Date().toISOString()
            await fs.writeFile(abs, JSON.stringify(review, null, 2), 'utf8')

            // 2) 寫入使用者勾選的新修正（不含未勾選）
            if (body.newCorrections?.length) {
              const corrPath = path.join(ROOT, 'assets/字幕修正清單.json')
              const corrData = JSON.parse(await fs.readFile(corrPath, 'utf8'))
              for (const c of body.newCorrections) {
                const exists = corrData.corrections.some(
                  e => e.wrong === c.wrong && e.right === c.right
                )
                if (!exists) corrData.corrections.push({ wrong: c.wrong, right: c.right })
              }
              await fs.writeFile(corrPath, JSON.stringify(corrData, null, 2), 'utf8')
            }

            // 3) 觸發 rerun（非同步，不等結果）
            let rerunStarted = false
            if (body.triggerRerun) {
              rerunStarted = true
              const child = execFile('node', [
                path.join(ROOT, 'scripts/pipeline/rerun-from-review.js'),
                abs,
              ], { env: { ...process.env, SKIP_UPLOAD: 'true' } })
              child.stdout?.pipe(process.stdout)
              child.stderr?.pipe(process.stderr)
              child.on('error', e => console.error('[rerun error]', e.message))
            }

            return json(res, {
              ok: true,
              message: rerunStarted ? '已送出並觸發重新渲染' : '已儲存審稿結果',
            })
          }
        } catch (err) {
          console.error('[review-api]', err)
          return json(res, { error: err.message }, 500)
        }

        next()
      })
    },
  }
}
