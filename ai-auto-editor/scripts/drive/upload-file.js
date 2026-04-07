import fs from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'
import { authorizeDrive } from './auth.js'

export async function ensureDriveFolder(folderName, parentId) {
  const auth = await authorizeDrive()
  const drive = google.drive({ version: 'v3', auth })

  const query = [
    `'${parentId}' in parents`,
    `name = '${folderName.replace(/'/g, "\\'")}'`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
  ].join(' and ')

  const list = await drive.files.list({
    q: query,
    fields: 'files(id,name)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  if (list.data.files?.length) return list.data.files[0]

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id,name',
    supportsAllDrives: true,
  })

  return created.data
}

export async function uploadFileToDrive(localPath, parentId, mimeType = 'application/octet-stream') {
  const auth = await authorizeDrive()
  const drive = google.drive({ version: 'v3', auth })
  const name = path.basename(localPath)

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath),
    },
    fields: 'id,name,webViewLink,webContentLink',
    supportsAllDrives: true,
  })

  return created.data
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , localPath, parentId, mimeType] = process.argv
  if (!localPath || !parentId) {
    console.error('Usage: node scripts/drive/upload-file.js <localPath> <parentId> [mimeType]')
    process.exit(1)
  }
  const result = await uploadFileToDrive(localPath, parentId, mimeType)
  console.log(JSON.stringify(result, null, 2))
}
