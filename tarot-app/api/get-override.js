import { get } from '@vercel/blob'

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
    const result = await get(pathname, { access: 'private' })

    if (!result || result.statusCode !== 200) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const text = await new Response(result.stream).text()
    res.status(200).json(JSON.parse(text))
  } catch (error) {
    console.error('get-override failed', error)
    res.status(500).json({ error: '讀取內容失敗' })
  }
}
