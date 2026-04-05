import { list, head, get } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { deviceId, cardId } = req.query
    if (!deviceId || !cardId) {
      res.status(400).json({ error: 'Missing deviceId or cardId' })
      return
    }

    const pathname = `overrides/${deviceId}/${cardId}.json`
    const blob = await head(pathname)
    const file = await get(blob.url)
    const text = await file.text()
    res.status(200).json(JSON.parse(text))
  } catch (error) {
    console.error('get-override failed', error)
    res.status(500).json({ error: '讀取內容失敗' })
  }
}
