import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { google } from 'googleapis'
import { authorizeDrive } from './auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '../..')
const RAW_DIR = path.join(ROOT_DIR, 'downloads', 'raw')

export async function downloadDriveFile(fileId, fileName) {
  await fsp.mkdir(RAW_DIR, { recursive: true })
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const outputPath = path.join(RAW_DIR, `${fileId}-${safeName}`)

  const auth = await authorizeDrive()
  const drive = google.drive({ version: 'v3', auth })
  const dest = fs.createWriteStream(outputPath)

  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  )

  await new Promise((resolve, reject) => {
    response.data
      .on('error', reject)
      .pipe(dest)
      .on('error', reject)
      .on('finish', resolve)
  })

  return outputPath
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , fileId, ...nameParts] = process.argv
  const fileName = nameParts.join(' ') || `${fileId}.bin`
  if (!fileId) {
    console.error('Usage: node scripts/drive/download-file.js <fileId> <fileName>')
    process.exit(1)
  }

  const output = await downloadDriveFile(fileId, fileName)
  console.log(output)
}
