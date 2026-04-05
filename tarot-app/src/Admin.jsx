import { useEffect, useMemo, useState } from 'react'
import './admin.css'

function Admin() {
  const [devices, setDevices] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedData, setSelectedData] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/list-overrides')
        const json = await response.json()
        if (!response.ok) throw new Error(json.error || 'failed')
        setDevices(json.devices || {})
        const firstDeviceId = Object.keys(json.devices || {})[0]
        if (firstDeviceId) setSelectedDeviceId(firstDeviceId)
      } catch (err) {
        setError('讀取備份清單失敗')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const deviceGroups = useMemo(() => Object.entries(devices), [devices])
  const currentEntries = selectedDeviceId ? devices[selectedDeviceId] || [] : []

  async function openItem(deviceId, item) {
    setSelectedDeviceId(deviceId)
    setSelectedItem(item)
    setSelectedData(null)

    try {
      const response = await fetch(`/api/get-override?deviceId=${encodeURIComponent(deviceId)}&cardId=${encodeURIComponent(item.cardId)}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || 'failed')
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
          <div className="device-tabs">
            {deviceGroups.map(([deviceId, entries]) => (
              <button
                key={deviceId}
                className={selectedDeviceId === deviceId ? 'device-tab active' : 'device-tab'}
                onClick={() => {
                  setSelectedDeviceId(deviceId)
                  setSelectedItem(null)
                  setSelectedData(null)
                }}
              >
                <strong>{deviceId}</strong>
                <small>{entries.length} 筆</small>
              </button>
            ))}
          </div>

          <div className="entry-list">
            {currentEntries.map((item) => (
              <button
                key={item.pathname}
                className={selectedItem?.pathname === item.pathname ? 'entry-item active' : 'entry-item'}
                onClick={() => openItem(selectedDeviceId, item)}
              >
                <strong>{item.cardId}</strong>
                <small>{new Date(item.uploadedAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-card detail-card">
          <h2>修改內容</h2>
          {!selectedItem ? <p>先選擇裝置，再點一筆紀錄查看內容。</p> : null}
          {selectedItem ? (
            <>
              <div className="meta-block">
                <div><strong>裝置</strong><span>{selectedDeviceId}</span></div>
                <div><strong>牌卡</strong><span>{selectedItem.cardId}</span></div>
                <div><strong>時間</strong><span>{new Date(selectedItem.uploadedAt).toLocaleString()}</span></div>
              </div>

              {selectedData?.error ? <p>{selectedData.error}</p> : null}

              {selectedData && !selectedData.error ? (
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
