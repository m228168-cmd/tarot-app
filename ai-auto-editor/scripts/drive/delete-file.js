import { google } from 'googleapis'
import { authorizeDrive } from './auth.js'

export async function deleteDriveFile(fileId) {
  const auth = await authorizeDrive()
  const drive = google.drive({ version: 'v3', auth })
  await drive.files.delete({ fileId, supportsAllDrives: true })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , fileId] = process.argv
  if (!fileId) {
    console.error('Usage: node scripts/drive/delete-file.js <fileId>')
    process.exit(1)
  }
  await deleteDriveFile(fileId)
  console.log(JSON.stringify({ ok: true, fileId }, null, 2))
}
