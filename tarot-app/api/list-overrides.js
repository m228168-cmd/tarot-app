import { list } from '@vercel/blob'

function parsePathname(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  const deviceId = parts[1] || 'unknown-device'
  const fileName = parts[2] || ''
  const cardId = fileName.replace(/\.json$/, '')
  return { deviceId, cardId }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { blobs } = await list({ prefix: 'overrides/' })
    const devices = {}

    for (const blob of blobs) {
      const { deviceId, cardId } = parsePathname(blob.pathname)
      if (!devices[deviceId]) devices[deviceId] = []
      devices[deviceId].push({
        cardId,
        pathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
        size: blob.size,
      })
    }

    Object.values(devices).forEach((entries) => {
      entries.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    })

    res.status(200).json({ ok: true, devices })
  } catch (error) {
    console.error('list-overrides failed', error)
    res.status(500).json({ error: 'Failed to list overrides' })
  }
}
