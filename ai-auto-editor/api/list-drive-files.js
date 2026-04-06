import { google } from 'googleapis'
import { authorizeDrive } from './drive-auth.js'

const FOLDER_ID = '1iY8c2sEOPrckjnE5eGwoGP-mUJquFVOx'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const auth = await authorizeDrive()
    const drive = google.drive({ version: 'v3', auth })

    const response = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,modifiedTime,size)',
      pageSize: 100,
      orderBy: 'modifiedTime desc',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    res.status(200).json({ ok: true, items: response.data.files || [] })
  } catch (error) {
    console.error('list-drive-files failed', error)
    res.status(500).json({ error: 'Failed to list Drive files', detail: error.message })
  }
}
