import { google } from 'googleapis'
import { authorizeDrive } from './auth.js'

const FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1iY8c2sEOPrckjnE5eGwoGP-mUJquFVOx'

export async function listDriveFiles() {
  const auth = await authorizeDrive()
  const drive = google.drive({ version: 'v3', auth })

  const response = await drive.files.list({
    q: `'${FOLDER_ID}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  return response.data.files || []
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await listDriveFiles()
  console.log(JSON.stringify(files, null, 2))
}
