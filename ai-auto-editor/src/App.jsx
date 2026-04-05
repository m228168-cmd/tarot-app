import './App.css'

const pipeline = [
  '上傳影片 / 音訊',
  '抽出音訊與語音辨識',
  '偵測停頓、空白、贅段',
  '整理逐字稿與重點',
  '輸出字幕與剪輯建議',
]

const outputs = [
  '逐字稿 transcript',
  '字幕檔 srt / vtt',
  '建議保留片段',
  '建議刪除片段',
  '重點摘要',
]

function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">AI Auto Editor</p>
        <h1>AI 自動剪輯助手</h1>
        <p className="lead">
          幫你把影片做成更順的版本：自動轉逐字稿、找停頓、抓重點、產生字幕，並提供剪輯建議。
        </p>

        <div className="hero-actions">
          <button className="primary">上傳素材</button>
          <button className="secondary">查看 MVP 規格</button>
        </div>
      </section>

      <section className="grid two-up">
        <article className="card">
          <h2>第一版會做什麼</h2>
          <ul>
            {pipeline.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>預期輸出</h2>
          <ul>
            {outputs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="grid">
        <article className="card wide">
          <h2>MVP 開發優先順序</h2>
          <ol>
            <li>上傳影片 / 音訊</li>
            <li>Whisper 逐字稿</li>
            <li>silence detect 偵測空白</li>
            <li>字幕檔輸出</li>
            <li>剪輯建議清單</li>
          </ol>
        </article>
      </section>
    </main>
  )
}

export default App
