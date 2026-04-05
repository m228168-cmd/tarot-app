import { useMemo, useState } from 'react'
import './App.css'
import { tarotCards } from './data/tarotCards'

const detailOptions = [
  { id: 'short', label: '短版' },
  { id: 'medium', label: '中版' },
  { id: 'full', label: '完整版' },
]

function App() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(tarotCards[0]?.id ?? '')
  const [meaningType, setMeaningType] = useState('upright')
  const [detailLevel, setDetailLevel] = useState('short')

  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) return tarotCards

    return tarotCards.filter((card) => {
      const haystacks = [
        card.name,
        card.arcana,
        card.number,
        ...card.keywords,
      ].map((value) => value.toLowerCase())

      return haystacks.some((value) => value.includes(normalized))
    })
  }, [query])

  const selectedCard =
    filteredCards.find((card) => card.id === selectedId) ?? filteredCards[0] ?? tarotCards[0]

  const currentText =
    selectedCard?.[detailLevel]?.[meaningType] ?? '目前沒有內容。'

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Tarot Finder</p>
        <h1>塔羅牌查詢小工具</h1>
        <p className="hero-copy">
          手機上快速查牌義。先查牌名，再切換正位 / 逆位，最後用短版、中版、完整版控制文字長度。
        </p>

        <label className="search-box" htmlFor="search">
          <span>搜尋牌名、編號、關鍵字</span>
          <input
            id="search"
            type="text"
            placeholder="例如：愚者、戀人、開始、轉機"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="chip-row">
          <button
            className={meaningType === 'upright' ? 'chip active' : 'chip'}
            onClick={() => setMeaningType('upright')}
          >
            正位
          </button>
          <button
            className={meaningType === 'reversed' ? 'chip active' : 'chip'}
            onClick={() => setMeaningType('reversed')}
          >
            逆位
          </button>
        </div>

        <div className="chip-row secondary">
          {detailOptions.map((option) => (
            <button
              key={option.id}
              className={detailLevel === option.id ? 'chip active' : 'chip'}
              onClick={() => setDetailLevel(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="content-grid">
        <aside className="card-list-panel">
          <div className="panel-head">
            <h2>牌卡列表</h2>
            <span>{filteredCards.length} 張</span>
          </div>

          <div className="card-list">
            {filteredCards.map((card) => (
              <button
                key={card.id}
                className={selectedCard?.id === card.id ? 'card-item active' : 'card-item'}
                onClick={() => setSelectedId(card.id)}
              >
                <div>
                  <p className="card-number">{card.number}</p>
                  <strong>{card.name}</strong>
                </div>
                <small>{card.arcana}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="detail-panel">
          {selectedCard ? (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">{selectedCard.arcana}</p>
                  <h2>
                    {selectedCard.name} <span>{selectedCard.number}</span>
                  </h2>
                </div>
              </div>

              <div className="keyword-row">
                {selectedCard.keywords.map((keyword) => (
                  <span key={keyword} className="keyword-pill">
                    {keyword}
                  </span>
                ))}
              </div>

              <article className="meaning-card">
                <div className="meaning-meta">
                  <span>{meaningType === 'upright' ? '正位' : '逆位'}</span>
                  <span>{detailOptions.find((item) => item.id === detailLevel)?.label}</span>
                </div>
                <p>{currentText}</p>
              </article>

              <section className="stacked-preview">
                <div className="mini-block">
                  <h3>短版摘要</h3>
                  <p>{selectedCard.short[meaningType]}</p>
                </div>
                <div className="mini-block">
                  <h3>中版說明</h3>
                  <p>{selectedCard.medium[meaningType]}</p>
                </div>
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
