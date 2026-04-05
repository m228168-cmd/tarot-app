import { put } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const { deviceId, cardId, upright, reversed, updatedAt } = body || {}

    if (!deviceId || !cardId || !Array.isArray(upright) || !Array.isArray(reversed)) {
      res.status(400).json({ error: 'Invalid payload' })
      return
    }

    const path = `overrides/${deviceId}/${cardId}.json`
    const payload = JSON.stringify({
      deviceId,
      cardId,
      upright,
      reversed,
      updatedAt: updatedAt || new Date().toISOString(),
    }, null, 2)

    const blob = await put(path, payload, {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
    })

    res.status(200).json({ ok: true, path, url: blob.url })
  } catch (error) {
    console.error('save-override failed', error)
    res.status(500).json({ error: 'Failed to save override' })
  }
}
