import { useEffect, useMemo, useState } from 'react'
import './admin.css'

function parsePathname(pathname) {
  const parts = pathname.split('/').filter(Boolean)
  const deviceId = parts[1] || 'unknown-device'
  const fileName = parts[2] || ''
  const cardId = fileName.replace(/\.json$/, '')
  return { deviceId, cardId }
}

function Admin() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [selectedData, setSelectedData] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/list-overrides')
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || 'failed')
        setItems(json.items || [])
      } catch (err) {
        setError('讀取備份清單失敗')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const grouped = useMemo(() => {
    const map = new Map()

    for (const item of items) {
      const { deviceId, cardId } = parsePathname(item.pathname)
      const entry = {
        ...item,
        deviceId,
        cardId,
      }

      if (!map.has(deviceId)) map.set(deviceId, [])
      map.get(deviceId).push(entry)
    }

    return Array.from(map.entries()).map(([deviceId, entries]) => ({
      deviceId,
      entries: entries.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)),
    }))
  }, [items])

  async function openItem(item) {
    setSelected(item)
    setSelectedData(null)

    try {
      const response = await fetch(item.url)
      const json = await response.json()
      setSelectedData(json)
    } catch (err) {
      setSelectedData({ error: '讀取內容失敗' })
    }
  }

  return (
    <main className="admin-shell">
      <section className="admin-header">
        <p>Tarot Admin</p>
        <h1>牌義備份管理頁</h1>
        <span>查看哪些裝置改了哪些牌</span>
      </section>

      {loading ? <div className="admin-card">讀取中...</div> : null}
      {error ? <div className="admin-card error">{error}</div> : null}

      <section className="admin-grid">
        <aside className="admin-card list-card">
          <h2>裝置列表</h2>
          {grouped.map((group) => (
            <section key={group.deviceId} className="device-group">
              <div className="device-head">
                <strong>{group.deviceId}</strong>
                <span>{group.entries.length} 筆</span>
              </div>

              <div className="entry-list">
                {group.entries.map((item) => (
                  <button key={item.pathname} className="entry-item" onClick={() => openItem(item)}>
                    <strong>{item.cardId}</strong>
                    <small>{new Date(item.uploadedAt).toLocaleString()}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <section className="admin-card detail-card">
          <h2>修改內容</h2>
          {!selected ? <p>點左邊一筆紀錄查看內容。</p> : null}
          {selected ? (
            <>
              <div className="meta-block">
                <div><strong>裝置</strong><span>{selected.deviceId}</span></div>
                <div><strong>牌卡</strong><span>{selected.cardId}</span></div>
                <div><strong>時間</strong><span>{new Date(selected.uploadedAt).toLocaleString()}</span></div>
              </div>

              {selectedData?.error ? <p>{selectedData.error}</p> : null}

              {selectedData ? (
                <div className="content-blocks">
                  <article>
                    <h3>正位</h3>
                    <ul>
                      {(selectedData.upright || []).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </article>
                  <article>
                    <h3>逆位</h3>
                    <ul>
                      {(selectedData.reversed || []).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </article>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </section>
    </main>
  )
}

export default Admin
