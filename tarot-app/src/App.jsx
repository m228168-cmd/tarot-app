import { useMemo, useState } from 'react'
import './App.css'
import { tarotCards } from './data/tarotCards'

function App() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(tarotCards[0]?.id ?? '')

  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) return tarotCards

    return tarotCards.filter((card) => {
      const haystacks = [card.name, card.englishName, card.arcana, card.number, ...card.upright, ...card.reversed]
        .map((value) => value.toLowerCase())

      return haystacks.some((value) => value.includes(normalized))
    })
  }, [query])

  const selectedCard =
    filteredCards.find((card) => card.id === selectedId) ?? filteredCards[0] ?? tarotCards[0]

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Rider-Waite Tarot</p>
        <h1>偉特塔羅牌查詢</h1>
        <p className="hero-copy">
          查到牌後，畫面直接同時顯示正位與逆位，方便快速比對牌意。
        </p>

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
            <h2>大阿爾克那</h2>
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
                  <small className="english-name">{card.englishName}</small>
                </div>
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
                  <p className="english-heading">{selectedCard.englishName}</p>
                </div>
              </div>

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
