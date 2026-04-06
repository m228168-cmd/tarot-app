const DRIVE_FOLDER_URL = 'https://drive.google.com/drive/folders/1iY8c2sEOPrckjnE5eGwoGP-mUJquFVOx?usp=sharing'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const response = await fetch(DRIVE_FOLDER_URL)
    const html = await response.text()

    const matches = [...html.matchAll(/aria-label="([^"]+?(?:mp3|mp4|mov|wav))"/gi)]
    const items = Array.from(new Set(matches.map((match) => match[1]))).map((name) => ({ name }))

    res.status(200).json({ ok: true, items })
  } catch (error) {
    console.error('list-drive-folder failed', error)
    res.status(500).json({ error: 'Failed to read folder' })
  }
}
