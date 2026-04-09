import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function ensureRasterMeme(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.svg') return filePath

  const outPath = filePath.replace(/\.svg$/i, '.preview.png')
  try {
    await fs.access(outPath)
    return outPath
  } catch {}

  const tmpDir = path.dirname(outPath)
  await execFileAsync('qlmanage', ['-t', '-s', '1024', '-o', tmpDir, filePath], {
    timeout: 120000,
  })

  const generated = path.join(tmpDir, `${path.basename(filePath)}.png`)
  try {
    await fs.access(generated)
    await fs.rename(generated, outPath)
    return outPath
  } catch {
    // fallback：有些系統可能輸出為 basename 不含副檔名
    const alt = path.join(tmpDir, `${path.basename(filePath, ext)}.png`)
    await fs.access(alt)
    await fs.rename(alt, outPath)
    return outPath
  }
}
