import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './ReviewWorkbench.css'

function fmt(sec) {
  const m = String(Math.floor((sec || 0) / 60)).padStart(2, '0')
  const s = String(Math.floor((sec || 0) % 60)).padStart(2, '0')
  return `${m}:${s}`
}

function memeThumbSrc(file) {
  return file ? `/media/assets/memes/${encodeURIComponent(file)}` : ''
}

// ── 梗圖 Mood Emoji 對照（無圖片時使用） ──────────────────
const MEME_EMOJI = {
  'surprised-pikachu': '⚡',
  'this-is-fine': '🔥',
  'thinking-guy': '🤔',
  'mind-blown': '🤯',
  'drake-approve': '👍',
  'facepalm': '🤦',
  'stonks': '📈',
  'distracted-bf': '👀',
  'thumbs-up-cat': '😺',
  'sad-cat': '😿',
  'smile-emoji': '🙂',
  'wikipedia-meme': '📚',
  'krazy-kat-panel': '🗯️',
}

export default function ReviewWorkbench() {
  // ── 狀態 ─────────────────────────────────────────────────
  const [reviewFiles, setReviewFiles] = useState([])
  const [selectedPath, setSelectedPath] = useState('')
  const [review, setReview] = useState(null)
  const [title, setTitle] = useState('')
  const [segments, setSegments] = useState([])
  const [memeSelections, setMemeSelections] = useState({}) // segId → memeId
  const [memes, setMemes] = useState([])
  const [newWrong, setNewWrong] = useState('')
  const [newRight, setNewRight] = useState('')
  const [manualCorrections, setManualCorrections] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [memePickerOpen, setMemePickerOpen] = useState(null) // segId or null
  const [showOnlyMemeSegments, setShowOnlyMemeSegments] = useState(false)
  const [safeOnly, setSafeOnly] = useState(true)
  const [previewVideoPath, setPreviewVideoPath] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef(null)
  const videoRef = useRef(null)
  const previewRef = useRef(null)
  const activeSegRef = useRef(null)

  const sortedMemes = [...memes].sort((a, b) => {
    const aSafe = (a.safetyTier || 'legacy') === 'safe' ? 0 : 1
    const bSafe = (b.safetyTier || 'legacy') === 'safe' ? 0 : 1
    return aSafe - bSafe || a.label.localeCompare(b.label, 'zh-Hant')
  })

  // ── 載入檔案清單 & 梗圖庫 ────────────────────────────────
  useEffect(() => {
    fetch('/api/review/list').then(r => r.json()).then(d => setReviewFiles(d.files || []))
    fetch('/api/review/memes').then(r => r.json()).then(d => setMemes(d.memes || []))
  }, [])

  // ── 載入選定的 review ────────────────────────────────────
  useEffect(() => {
    if (!selectedPath) return
    fetch(`/api/review/load?path=${encodeURIComponent(selectedPath)}`)
      .then(r => r.json())
      .then(data => {
        setReview(data)
        setTitle(data.title || '')
        setSegments(data.segments?.map(s => ({ ...s })) || [])
        setMemeSelections(data.memeSelections || {})
        setPreviewVideoPath(data?.output?.videoPath || '')
        setManualCorrections([])
        setNewWrong('')
        setNewRight('')
      })
  }, [selectedPath])

  // ── 段落文字編輯 ─────────────────────────────────────────
  const updateSegmentText = useCallback((id, text) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, text } : s))
  }, [])

  const displayedSegments = useMemo(() => {
    if (!showOnlyMemeSegments) return segments
    return segments.filter(seg => Boolean(memeSelections[seg.id]))
  }, [segments, memeSelections, showOnlyMemeSegments])

  const activeSegment = useMemo(() => {
    return segments.find(seg => currentTime >= seg.start && currentTime <= seg.end) || null
  }, [segments, currentTime])

  const activeSegmentId = activeSegment?.id ?? null
  const activeSegmentIndex = activeSegment ? segments.findIndex(seg => seg.id === activeSegment.id) : -1

  useEffect(() => {
    if (activeSegRef.current) {
      activeSegRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeSegmentId])

  const recommendMemes = useCallback(async () => {
    const payloadSegments = segments.map(seg => ({
      id: seg.id,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      originalText: seg.originalText,
    }))

    const resp = await fetch('/api/review/recommend-memes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: payloadSegments }),
    })
    const data = await resp.json()

    let next = data.memeSelections || {}
    if (safeOnly) {
      next = Object.fromEntries(
        Object.entries(next).filter(([, memeId]) => {
          const meme = sortedMemes.find(m => m.id === memeId)
          return (meme?.safetyTier || 'legacy') === 'safe'
        })
      )
    }

    setMemeSelections(next)
    setToast(`已重新推薦 ${Object.keys(next).length} 段梗圖`)
    setTimeout(() => setToast(''), 2500)
  }, [segments, sortedMemes, safeOnly])

  // ── 梗圖選擇 ────────────────────────────────────────────
  const selectMeme = useCallback((segId, memeId) => {
    setMemeSelections(prev => {
      const next = { ...prev }
      if (memeId) next[segId] = memeId
      else delete next[segId]
      return next
    })
    setMemePickerOpen(null)
  }, [])

  const addManualCorrection = () => {
    if (!newWrong.trim() || !newRight.trim()) return
    setManualCorrections(prev => [...prev, { wrong: newWrong.trim(), right: newRight.trim() }])
    setNewWrong('')
    setNewRight('')
  }

  const removeManualCorrection = (idx) => {
    setManualCorrections(prev => prev.filter((_, i) => i !== idx))
  }

  // ── 跳到音訊位置 ────────────────────────────────────────
  const seekTo = (sec) => {
    const player = videoRef.current || audioRef.current
    if (player) {
      player.currentTime = sec
      player.play()
      setCurrentTime(sec)
    }
  }

  const jumpSegment = (delta) => {
    if (activeSegmentIndex < 0) return
    const next = segments[activeSegmentIndex + delta]
    if (next) seekTo(next.start)
  }

  const restoreActiveOriginalText = () => {
    if (!activeSegment) return
    updateSegmentText(activeSegment.id, activeSegment.originalText || activeSegment.text || '')
  }

  const clearActiveMeme = () => {
    if (!activeSegment) return
    selectMeme(activeSegment.id, null)
  }

  const applySuggestedToActive = async () => {
    if (!activeSegment) return
    const resp = await fetch('/api/review/recommend-memes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: [{
          id: activeSegment.id,
          start: activeSegment.start,
          end: activeSegment.end,
          text: activeSegment.text,
          originalText: activeSegment.originalText,
        }],
      }),
    })
    const data = await resp.json()
    const entries = Object.entries(data.memeSelections || {})
    if (entries.length) {
      selectMeme(activeSegment.id, entries[0][1])
      setToast('已套用這一句的推薦迷因')
      setTimeout(() => setToast(''), 2000)
    }
  }

  // ── 儲存（不送出） ──────────────────────────────────────
  const handleSave = async () => {
    setSubmitting(true)
    try {
      await fetch('/api/review/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, title, segments, memeSelections }),
      })
      setToast('已暫存')
      setTimeout(() => setToast(''), 2000)
    } finally {
      setSubmitting(false)
    }
  }

  // ── 一鍵送出 ────────────────────────────────────────────
  const [triggerRerun, setTriggerRerun] = useState(false)

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const resp = await fetch('/api/review/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedPath,
          title,
          segments,
          memeSelections,
          newCorrections: manualCorrections,
          triggerRerun,
        }),
      })
      const result = await resp.json()
      if (result.output?.videoPath) {
        setPreviewVideoPath(result.output.videoPath)
        setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
      }
      setToast(result.message || '送出成功')
      setTimeout(() => setToast(''), 3000)
    } catch (err) {
      setToast('送出失敗: ' + err.message)
      setTimeout(() => setToast(''), 4000)
    } finally {
      setSubmitting(false)
    }
  }

  // ── 音訊路徑 ────────────────────────────────────────────
  const audioSrc = review?.output?.mergedAudioPath
    ? `/media/${review.output.mergedAudioPath}`
    : review?.source?.audioPath
      ? `/media/${review.source.audioPath}`
      : null

  // ── UI ──────────────────────────────────────────────────
  return (
    <main className="wb-shell">
      <header className="wb-header">
        <h1>審稿工作台</h1>
        <a href="#/" className="wb-back">← 返回首頁</a>
      </header>

      {/* 檔案選擇 */}
      <section className="wb-card">
        <label className="wb-label">選擇審稿檔</label>
        <select
          className="wb-select"
          value={selectedPath}
          onChange={e => setSelectedPath(e.target.value)}
        >
          <option value="">-- 請選擇 --</option>
          {reviewFiles.map(f => (
            <option key={f} value={f}>{f.split('/').slice(-2).join('/')}</option>
          ))}
        </select>
      </section>

      {review && (
        <>
          {/* 標題 */}
          <section className="wb-card">
            <label className="wb-label">標題</label>
            <input
              className="wb-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="輸入標題…"
            />
          </section>

          {previewVideoPath ? (
            <section className="wb-card wb-player-card" ref={previewRef}>
              <label className="wb-label">成品預覽（邊播邊改字幕）</label>
              <div className="wb-video-wrap">
                <video
                  ref={videoRef}
                  className="wb-video"
                  controls
                  playsInline
                  src={`/media/${previewVideoPath}`}
                  onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
                />
                {activeSegment && (
                  <div className="wb-video-caption-overlay">
                    {activeSegment.text || activeSegment.originalText}
                  </div>
                )}
              </div>
              <div className="wb-playhead">目前播放：{fmt(currentTime)}</div>
              {activeSegment && (
                <div className="wb-live-caption">
                  <div className="wb-live-caption-label">目前字幕</div>
                  <textarea
                    className="wb-live-caption-editor"
                    rows={3}
                    value={activeSegment.text || activeSegment.originalText || ''}
                    onChange={e => updateSegmentText(activeSegment.id, e.target.value)}
                  />
                  <div className="wb-live-tools">
                    <button type="button" className="wb-tool-btn" onClick={() => jumpSegment(-1)}>上一句</button>
                    <button type="button" className="wb-tool-btn" onClick={() => jumpSegment(1)}>下一句</button>
                    <button type="button" className="wb-tool-btn" onClick={restoreActiveOriginalText}>回原文</button>
                    <button type="button" className="wb-tool-btn" onClick={clearActiveMeme}>清空迷因</button>
                    <button type="button" className="wb-tool-btn primary" onClick={applySuggestedToActive}>套推薦</button>
                  </div>
                  <button
                    type="button"
                    className={`wb-live-meme-btn ${memeSelections[activeSegment.id] ? 'has-meme' : ''}`}
                    onClick={() => setMemePickerOpen(memePickerOpen === activeSegment.id ? null : activeSegment.id)}
                  >
                    {memeSelections[activeSegment.id]
                      ? `${MEME_EMOJI[memeSelections[activeSegment.id]] || '🖼'} ${memes.find(m => m.id === memeSelections[activeSegment.id])?.label || '已選迷因'}`
                      : '+ 幫這句選迷因'}
                  </button>
                  {memePickerOpen === activeSegment.id && (
                    <div className="wb-sheet-backdrop" onClick={() => setMemePickerOpen(null)}>
                      <div className="wb-meme-sheet" onClick={e => e.stopPropagation()}>
                        <div className="wb-meme-sheet-handle" />
                        <div className="wb-meme-sheet-title">替這句選迷因</div>
                        <div className="wb-meme-picker wb-meme-picker-live">
                      <button
                        type="button"
                        className="wb-meme-opt"
                        onClick={() => selectMeme(activeSegment.id, null)}
                      >
                        ❌ 不使用
                      </button>
                        {sortedMemes
                          .filter(m => !safeOnly || (m.safetyTier || 'legacy') === 'safe')
                          .map(m => (
                            <button
                              key={m.id}
                              type="button"
                              className={`wb-meme-opt wb-meme-thumb-opt ${memeSelections[activeSegment.id] === m.id ? 'selected' : ''} ${(m.safetyTier || 'legacy') === 'safe' ? 'safe' : 'legacy'}`}
                              onClick={() => selectMeme(activeSegment.id, m.id)}
                            >
                              <span className="wb-meme-thumb-wrap">
                                <img className="wb-meme-thumb" src={memeThumbSrc(m.file)} alt={m.label} loading="lazy" />
                              </span>
                              <span className="wb-meme-meta">
                                <span className="wb-meme-label">{m.label}</span>
                                <span className="wb-meme-keywords">{(m.triggers || []).slice(0, 3).join('・')}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="wb-preview-path">{previewVideoPath}</div>
            </section>
          ) : audioSrc && (
            <section className="wb-card wb-player-card">
              <label className="wb-label">播放音訊</label>
              <audio
                ref={audioRef}
                controls
                src={audioSrc}
                className="wb-audio"
                onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
              />
              <div className="wb-playhead">目前播放：{fmt(currentTime)}</div>
            </section>
          )}

          {/* 字幕段落 */}
          <section className="wb-card wb-editor-card">
            <div className="wb-toolbar">
              <label className="wb-label">字幕（{displayedSegments.length}/{segments.length} 段）</label>
              <div className="wb-toolbar-actions">
                <button type="button" className="wb-chip" onClick={recommendMemes}>重新自動推薦</button>
                <button
                  type="button"
                  className={`wb-chip ${showOnlyMemeSegments ? 'active' : ''}`}
                  onClick={() => setShowOnlyMemeSegments(v => !v)}
                >
                  只看有梗圖
                </button>
                <button
                  type="button"
                  className={`wb-chip ${safeOnly ? 'active' : ''}`}
                  onClick={() => setSafeOnly(v => !v)}
                >
                  safe only
                </button>
              </div>
            </div>
            <div className="wb-segments">
              {displayedSegments.map((seg) => (
                <div
                  key={seg.id}
                  ref={activeSegmentId === seg.id ? activeSegRef : null}
                  className={`wb-seg ${activeSegmentId === seg.id ? 'active' : ''}`}
                >
                  <div className="wb-seg-head">
                    <button
                      type="button"
                      className="wb-seg-time"
                      onClick={() => seekTo(seg.start)}
                      title="點擊跳到此處播放"
                    >
                      {fmt(seg.start)} → {fmt(seg.end)}
                    </button>
                    <button
                      type="button"
                      className={`wb-meme-btn ${memeSelections[seg.id] ? 'has-meme' : ''}`}
                      onClick={() => setMemePickerOpen(memePickerOpen === seg.id ? null : seg.id)}
                      title="選擇梗圖"
                    >
                      {memeSelections[seg.id]
                        ? (MEME_EMOJI[memeSelections[seg.id]] || '🖼') + ' ' +
                          (memes.find(m => m.id === memeSelections[seg.id])?.label || '')
                        : '+ 梗圖'}
                    </button>
                  </div>
                  <textarea
                    className="wb-seg-text"
                    rows={activeSegmentId === seg.id ? 4 : 2}
                    value={seg.text}
                    onChange={e => updateSegmentText(seg.id, e.target.value)}
                  />
                  {seg.originalText && seg.originalText !== seg.text && (
                    <div className="wb-seg-orig">原始：{seg.originalText}</div>
                  )}
                  {/* 梗圖選擇器 */}
                  {memePickerOpen === seg.id && (
                    <div className="wb-meme-picker">
                      <button
                        type="button"
                        className="wb-meme-opt"
                        onClick={() => selectMeme(seg.id, null)}
                      >
                        ❌ 不使用
                      </button>
                      {sortedMemes
                        .filter(m => !safeOnly || (m.safetyTier || 'legacy') === 'safe')
                        .map(m => (
                        <button
                          key={m.id}
                          type="button"
                          className={`wb-meme-opt wb-meme-thumb-opt ${memeSelections[seg.id] === m.id ? 'selected' : ''} ${(m.safetyTier || 'legacy') === 'safe' ? 'safe' : 'legacy'}`}
                          onClick={() => selectMeme(seg.id, m.id)}
                        >
                          <span className="wb-meme-thumb-wrap">
                            <img className="wb-meme-thumb" src={memeThumbSrc(m.file)} alt={m.label} loading="lazy" />
                          </span>
                          <span className="wb-meme-meta">
                            <span className="wb-meme-label">{m.label}</span>
                            <span className="wb-meme-keywords">{(m.triggers || []).slice(0, 3).join('・')}</span>
                          </span>
                          <span className="wb-meme-tier">{(m.safetyTier || 'legacy') === 'safe' ? 'safe' : 'legacy'}</span>
                          {memeSelections[seg.id] === m.id && review?.memeSelections?.[seg.id] === m.id && (
                            <span className="wb-meme-tier wb-meme-tier-auto">自動</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 手動錯別字提交 */}
          <section className="wb-card">
            <label className="wb-label">手動錯別字提交</label>
            <div className="wb-typo-add">
              <input
                className="wb-input wb-input-sm"
                placeholder="錯誤詞"
                value={newWrong}
                onChange={e => setNewWrong(e.target.value)}
              />
              <span className="wb-typo-arrow">→</span>
              <input
                className="wb-input wb-input-sm"
                placeholder="正確詞"
                value={newRight}
                onChange={e => setNewRight(e.target.value)}
              />
              <button type="button" className="wb-btn-sm" onClick={addManualCorrection}>
                加入
              </button>
            </div>
            {manualCorrections.length > 0 && (
              <div className="wb-typo-list">
                {manualCorrections.map((c, i) => (
                  <div key={`${c.wrong}-${c.right}-${i}`} className="wb-typo-item">
                    <span className="wb-typo-wrong">{c.wrong}</span>
                    <span className="wb-typo-arrow">→</span>
                    <span className="wb-typo-right">{c.right}</span>
                    <button type="button" className="wb-chip" onClick={() => removeManualCorrection(i)}>移除</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 送出 */}
          <section className="wb-card wb-submit-card">
            <label className="wb-rerun-toggle">
              <input
                type="checkbox"
                checked={triggerRerun}
                onChange={e => setTriggerRerun(e.target.checked)}
              />
              同時觸發重新渲染（rerun pipeline）
            </label>
            <div className="wb-actions">
              <button
                type="button"
                className="wb-btn-secondary"
                onClick={handleSave}
                disabled={submitting}
              >
                暫存
              </button>
              <button
                type="button"
                className="wb-btn-primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? '送出中…' : '一鍵送出'}
              </button>
            </div>
          </section>
        </>
      )}

      {/* Toast */}
      {toast && <div className="wb-toast">{toast}</div>}
    </main>
  )
}
