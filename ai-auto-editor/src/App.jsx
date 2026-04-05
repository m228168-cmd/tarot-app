import { useMemo, useState } from 'react'
import './App.css'

function formatTime(value) {
  const total = Math.floor(value || 0)
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function App() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const segmentCount = useMemo(() => result?.segments?.length || 0, [result])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!file) return

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })

      const json = await response.json()
      if (!response.ok) throw new Error(json.error || 'failed')
      setResult(json)
    } catch (err) {
      setError('轉錄失敗，請再試一次')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">AI Auto Editor</p>
        <h1>AI 自動剪輯助手</h1>
        <p className="lead">
          第一版先做上傳素材、自動轉文字、顯示逐字稿，讓後面的剪輯與字幕流程有基礎。
        </p>
      </section>

      <section className="card uploader-card">
        <h2>上傳音訊 / 影片</h2>
        <form className="upload-form" onSubmit={handleSubmit}>
          <label className="file-box">
            <span>選擇檔案</span>
            <input
              type="file"
              accept="audio/*,video/*"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>

          <button className="primary" type="submit" disabled={!file || loading}>
            {loading ? '轉錄中...' : '開始轉文字'}
          </button>
        </form>

        {file ? <p className="hint">已選擇：{file.name}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      {result ? (
        <section className="grid two-up">
          <article className="card">
            <h2>轉錄結果</h2>
            <p className="meta-line">檔案：{result.filename}</p>
            <p className="meta-line">語言：{result.language}</p>
            <p className="meta-line">段落數：{segmentCount}</p>
            <div className="transcript-box">{result.text}</div>
          </article>

          <article className="card">
            <h2>逐段時間軸</h2>
            <div className="segment-list">
              {(result.segments || []).map((segment) => (
                <div key={`${segment.start}-${segment.end}`} className="segment-item">
                  <strong>
                    {formatTime(segment.start)} → {formatTime(segment.end)}
                  </strong>
                  <p>{segment.text}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  )
}

export default App
