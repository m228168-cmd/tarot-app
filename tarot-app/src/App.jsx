import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { tarotCards } from './data/tarotCards'

const DEVICE_ID_KEY = 'tarot-device-id'
const OVERRIDES_KEY = 'tarot-card-overrides'
const HISTORY_KEY = 'tarot-card-history'

function createDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY)

  if (existing) return existing

  const nextId = createDeviceId()
  localStorage.setItem(DEVICE_ID_KEY, nextId)
  return nextId
}

function App() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(tarotCards[0]?.id ?? '')
  const [deviceId, setDeviceId] = useState('')
  const [overrides, setOverrides] = useState({})
  const [historyMap, setHistoryMap] = useState({})
  const [isEditing, setIsEditing] = useState(false)
  const [editor, setEditor] = useState({ upright: '', reversed: '' })

  useEffect(() => {
    const nextDeviceId = getDeviceId()
    setDeviceId(nextDeviceId)

    const storedOverrides = localStorage.getItem(OVERRIDES_KEY)
    const storedHistory = localStorage.getItem(HISTORY_KEY)

    if (storedOverrides) {
      setOverrides(JSON.parse(storedOverrides))
    }

    if (storedHistory) {
      setHistoryMap(JSON.parse(storedHistory))
    }
  }, [])

  const cardsWithOverrides = useMemo(() => {
    return tarotCards.map((card) => {
      const override = overrides[card.id]

      if (!override) return card

      return {
        ...card,
        upright: override.upright,
        reversed: override.reversed,
      }
    })
  }, [overrides])

  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) return cardsWithOverrides

    return cardsWithOverrides.filter((card) => {
      const haystacks = [card.name, card.englishName, card.arcana, card.number, ...card.upright, ...card.reversed]
        .map((value) => value.toLowerCase())

      return haystacks.some((value) => value.includes(normalized))
    })
  }, [query, cardsWithOverrides])

  const groupedCards = useMemo(() => {
    const groups = {
      '大阿爾克那': filteredCards.filter((card) => card.arcana === '大阿爾克那'),
      '小阿爾克那': filteredCards.filter((card) => card.arcana === '小阿爾克那'),
      宮廷牌: filteredCards.filter((card) => card.arcana === '宮廷牌'),
    }

    return Object.entries(groups).filter(([, cards]) => cards.length > 0)
  }, [filteredCards])

  const selectedCard =
    filteredCards.find((card) => card.id === selectedId) ?? filteredCards[0] ?? cardsWithOverrides[0]

  const originalCard = tarotCards.find((card) => card.id === selectedCard?.id)
  const hasOverride = Boolean(selectedCard && overrides[selectedCard.id])
  const historyCount = selectedCard ? historyMap[selectedCard.id]?.length ?? 0 : 0

  useEffect(() => {
    if (!selectedCard) return

    setEditor({
      upright: selectedCard.upright.join('\n'),
      reversed: selectedCard.reversed.join('\n'),
    })
    setIsEditing(false)
  }, [selectedCard?.id])

  const persistOverrides = (nextOverrides) => {
    setOverrides(nextOverrides)
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(nextOverrides))
  }

  const persistHistory = (nextHistory) => {
    setHistoryMap(nextHistory)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
  }

  const handleSave = () => {
    if (!selectedCard || !originalCard) return

    const upright = editor.upright
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)

    const reversed = editor.reversed
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)

    const nextOverrides = {
      ...overrides,
      [selectedCard.id]: { upright, reversed, updatedAt: new Date().toISOString() },
    }

    const nextHistory = {
      ...historyMap,
      [selectedCard.id]: [
        {
          changedAt: new Date().toISOString(),
          deviceId,
          upright,
          reversed,
          basedOnOriginal: {
            upright: originalCard.upright,
            reversed: originalCard.reversed,
          },
        },
        ...(historyMap[selectedCard.id] ?? []),
      ].slice(0, 20),
    }

    persistOverrides(nextOverrides)
    persistHistory(nextHistory)
    setIsEditing(false)
  }

  const handleReset = () => {
    if (!selectedCard || !originalCard) return

    const nextOverrides = { ...overrides }
    delete nextOverrides[selectedCard.id]

    const nextHistory = {
      ...historyMap,
      [selectedCard.id]: [
        {
          changedAt: new Date().toISOString(),
          deviceId,
          resetToOriginal: true,
          upright: originalCard.upright,
          reversed: originalCard.reversed,
        },
        ...(historyMap[selectedCard.id] ?? []),
      ].slice(0, 20),
    }

    persistOverrides(nextOverrides)
    persistHistory(nextHistory)
    setEditor({
      upright: originalCard.upright.join('\n'),
      reversed: originalCard.reversed.join('\n'),
    })
    setIsEditing(false)
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Rider-Waite Tarot</p>
        <h1>偉特塔羅牌查詢</h1>

        <label className="search-box" htmlFor="search">
          <span>搜尋偉特塔羅牌意關鍵字</span>
          <input
            id="search"
            type="text"
            placeholder="例如：愚者、The Fool、轉機、重生"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </section>

      <section className="content-grid">
        <aside className="card-list-panel">
          <div className="panel-head">
            <h2>牌卡列表</h2>
            <span>{filteredCards.length} 張</span>
          </div>

          <div className="card-list grouped">
            {groupedCards.map(([groupName, cards]) => (
              <section key={groupName} className="card-group">
                <div className="group-title">{groupName}</div>
                {cards.map((card) => (
                  <button
                    key={card.id}
                    className={selectedCard?.id === card.id ? 'card-item active' : 'card-item'}
                    onClick={() => setSelectedId(card.id)}
                  >
                    <div>
                      <p className="card-number">{card.number}</p>
                      <strong>{card.name}</strong>
                      <small className="english-name">{card.englishName}</small>
                    </div>
                    {overrides[card.id] ? <span className="edited-badge">已改</span> : null}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </aside>

        <section className="detail-panel">
          {selectedCard ? (
            <>
              <div className="detail-header">
                <div className="title-block">
                  <p className="eyebrow mobile-only-meta">{selectedCard.arcana}</p>
                  <div className="title-row">
                    <h2>
                      {selectedCard.name}
                      <span className="desktop-only-meta">{selectedCard.number}</span>
                    </h2>
                    {selectedCard.image ? (
                      <img
                        className="mini-card-image mobile-only-meta"
                        src={selectedCard.image}
                        alt={`${selectedCard.name} mini`}
                      />
                    ) : null}
                  </div>
                  <p className="english-heading desktop-only-meta">{selectedCard.englishName}</p>
                </div>
                <div className="detail-actions desktop-only-meta">
                  <button className="action-button" onClick={() => setIsEditing((value) => !value)}>
                    {isEditing ? '取消編輯' : '編輯牌意'}
                  </button>
                  <button className="action-button muted" onClick={handleReset} disabled={!hasOverride}>
                    回復原始牌意
                  </button>
                </div>
              </div>

              {isEditing ? (
                <section className="editor-panel">
                  <div className="editor-grid">
                    <label>
                      <span>正位（每行一個關鍵字或句子）</span>
                      <textarea
                        value={editor.upright}
                        onChange={(event) => setEditor((prev) => ({ ...prev, upright: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>逆位（每行一個關鍵字或句子）</span>
                      <textarea
                        value={editor.reversed}
                        onChange={(event) => setEditor((prev) => ({ ...prev, reversed: event.target.value }))}
                      />
                    </label>
                  </div>

                  <div className="editor-actions">
                    <button className="action-button" onClick={handleSave}>儲存這台裝置的版本</button>
                    <button className="action-button muted" onClick={() => setIsEditing(false)}>先不改</button>
                  </div>
                </section>
              ) : null}

              <section className="detail-layout">
                <section className="meaning-grid-wrap">
                  <section className="meaning-grid">
                    <article className="meaning-card upright-card">
                      <div className="meaning-meta">
                        <span>正位</span>
                      </div>
                      <ul>
                        {selectedCard.upright.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>

                    <article className="meaning-card reversed-card">
                      <div className="meaning-meta">
                        <span>逆位</span>
                      </div>
                      <ul>
                        {selectedCard.reversed.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </article>
                  </section>

                  <div className="detail-actions mobile-only-actions">
                    <button className="action-button" onClick={() => setIsEditing((value) => !value)}>
                      {isEditing ? '取消編輯' : '編輯牌意'}
                    </button>
                    <button className="action-button muted" onClick={handleReset} disabled={!hasOverride}>
                      回復原始牌意
                    </button>
                  </div>
                </section>

                <section className="card-visual">
                  {selectedCard.image ? (
                    <img
                      className="card-image"
                      src={selectedCard.image}
                      alt={`${selectedCard.name} ${selectedCard.englishName}`}
                    />
                  ) : (
                    <div className="image-placeholder">
                      <span>偉特牌圖位置</span>
                      <strong>{selectedCard.name}</strong>
                      <small>{selectedCard.englishName}</small>
                    </div>
                  )}
                </section>
              </section>
            </>
          ) : (
            <div className="empty-state">找不到符合的牌。</div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
