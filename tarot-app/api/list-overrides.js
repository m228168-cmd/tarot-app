import { list } from '@vercel/blob'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { blobs } = await list({ prefix: 'overrides/' })
    const items = blobs.map((blob) => ({
      pathname: blob.pathname,
      url: blob.url,
      uploadedAt: blob.uploadedAt,
      size: blob.size,
    }))

    res.status(200).json({ ok: true, items })
  } catch (error) {
    console.error('list-overrides failed', error)
    res.status(500).json({ error: 'Failed to list overrides' })
  }
}
