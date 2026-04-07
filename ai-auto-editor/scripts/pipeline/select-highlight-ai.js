/**
 * select-highlight-ai.js
 *
 * 兩段式 AI 精華選段：
 * 1. 本機預篩：合併 segments → 過濾雜訊 → 取候選句群（免費）
 * 2. GPT-4o：從候選句群中選出最有情緒張力的 45-55 秒片段
 *
 * 回傳 { ranges: [{start, end, reason}], totalDuration }
 */

import OpenAI from 'openai'
import 'dotenv/config'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ─── 第一段：本機預篩 ────────────────────────────────────────────
// 滑動視窗（30s，每 20s 跳一格）從 segments 取候選句群
function buildCandidateChunks(segments, chunkSecs = 30, stepSecs = 20) {
  const noisePattern = /^[對嗯啊喔哦好是OK囉嗯啊哈呢吧啦哇]{1,4}$/
  const validSegs = segments.filter(s => {
    const t = (s.text || '').trim()
    return t.length >= 2 && !noisePattern.test(t)
  })

  if (!validSegs.length) return []

  const totalEnd = validSegs[validSegs.length - 1].end
  const chunks = []

  for (let windowStart = 0; windowStart < totalEnd - chunkSecs / 2; windowStart += stepSecs) {
    const windowEnd = windowStart + chunkSecs
    const inWindow = validSegs.filter(s => s.start >= windowStart && s.start < windowEnd)
    if (inWindow.length < 3) continue  // 太少內容跳過

    // 合併同一視窗內的文字
    const text = inWindow.map(s => s.text.trim()).join('')
    if (text.length < 20) continue  // 內容太短跳過

    chunks.push({
      start: windowStart,
      end: Math.min(windowEnd, inWindow[inWindow.length - 1].end),
      text: text.slice(0, 200),  // 最多 200 字送給 GPT
    })
  }

  // 本機評分：字密度高 + 含情緒詞 → 優先送給 GPT
  const emotionWords = /無聊|難過|害怕|開心|驚訝|意外|沒想到|原來|真的|其實|居然|竟然|重要|關鍵|必須|一定|從來|從不|永遠|改變|突破|覺悟|醒悟|後悔|感動|崩潰|緊張|焦慮|衝突|矛盾|掙扎/
  const scored = chunks.map(c => {
    const density = c.text.length / (c.end - c.start + 1)  // 字/秒
    const hasEmotion = emotionWords.test(c.text) ? 2 : 0
    return { ...c, score: density + hasEmotion }
  })

  // 分成前中後三段各取精華，避免只抓開頭
  const third = Math.floor(scored.length / 3)
  const topN = 16  // 每段取 16 個
  const top = [
    ...scored.slice(0, third).sort((a, b) => b.score - a.score).slice(0, topN),
    ...scored.slice(third, third * 2).sort((a, b) => b.score - a.score).slice(0, topN),
    ...scored.slice(third * 2).sort((a, b) => b.score - a.score).slice(0, topN),
  ].sort((a, b) => a.start - b.start)

  return top
}

// ─── 第二段：GPT-4o 選段 ─────────────────────────────────────────
export async function selectHighlightWithAI(segments, targetDurationSecs = 50) {
  const chunks = buildCandidateChunks(segments)
  console.error(`[ai-select] 候選句群: ${chunks.length} 個，送 GPT-4o 分析...`)

  // 整理成 prompt 用的文字
  const chunksText = chunks.map((c, i) => {
    const m = Math.floor(c.start / 60)
    const s = Math.floor(c.start % 60)
    return `[${i + 1}] ${m}:${String(s).padStart(2, '0')}（${c.start.toFixed(0)}s-${c.end.toFixed(0)}s）\n${c.text}`
  }).join('\n\n')

  const prompt = `你是短影音剪輯師，專門剪輯吸引人的繁體中文短影音（YouTube Shorts / TikTok）。

以下是一段影片的逐字稿候選片段，每段約 30 秒。請選出「最有情緒張力、最容易引起共鳴或讓人驚訝」的片段，組合成約 ${targetDurationSecs} 秒的精華。

選擇標準（依重要性排序）：
1. 有明確觀點或金句（讓人印象深刻的一句話）
2. 有情緒起伏或轉折（意外、驚訝、頓悟）
3. 貼近日常生活共鳴（工作、關係、心態）
4. 完整的概念（有頭有尾，不要切到一半）

請回傳 JSON 格式：
{
  "ranges": [
    { "start": 數字（秒）, "end": 數字（秒）, "reason": "選這段的原因" }
  ],
  "totalDuration": 數字（秒）,
  "hook": "這段內容的一句話標題（繁體中文，適合當短影音標題）"
}

候選片段：
${chunksText}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  })

  const result = JSON.parse(response.choices[0].message.content)
  const usage = response.usage
  console.error(`[ai-select] GPT-4o 完成 | tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out | 費用估算: $${((usage.prompt_tokens * 2.5 + usage.completion_tokens * 10) / 1_000_000).toFixed(4)}`)
  console.error(`[ai-select] 選出 ${result.ranges.length} 段，總時長 ${result.totalDuration}s`)
  console.error(`[ai-select] Hook: ${result.hook}`)

  return result
}

// ─── GPT-4o 字幕重寫 ─────────────────────────────────────────────
// 傳入原始 Whisper segments（已重對齊時間軸），讓 GPT 清理並重新斷句
// 回傳與原版相同格式的 segments：[{ start, end, text }]
export async function rewriteSubtitlesWithAI(segments) {
  if (!segments.length) return segments

  // 整理成 GPT 易讀格式
  const input = segments.map((s, i) =>
    `${i},${s.start.toFixed(2)},${s.end.toFixed(2)},${s.text}`
  ).join('\n')

  const prompt = `你是短影音字幕編輯，專門優化繁體中文字幕。

以下是 Whisper 自動轉錄的字幕（格式：索引,開始秒,結束秒,文字）。
請依照以下規則重寫每一行的文字（時間軸不要動）：

規則：
1. 去除廢話詞：嗯、啊、哦、那個、就是、然後然後、對對對 等填充詞
2. 修正明顯的轉錄錯誤（中文同音字替換）
3. 每行最多 7 個字，超過的自動斷成兩行（用 \\N 換行）
4. 保留語氣和原意，不要過度修改
5. 如果某行去掉廢話後變成空的，刪除那行（回傳時跳過）
6. 不要合併或拆分時間軸，每個索引對應原來的時間段

回傳 JSON：
{
  "subtitles": [
    { "index": 數字, "start": 秒, "end": 秒, "original": "原始文字", "text": "改寫後文字" }
  ]
}

原始字幕：
${input}`

  console.error(`[ai-subs] 送 GPT-4o 重寫 ${segments.length} 條字幕...`)

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

  const result = JSON.parse(response.choices[0].message.content)
  const usage = response.usage
  console.error(`[ai-subs] 完成 | tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out | 費用: $${((usage.prompt_tokens * 2.5 + usage.completion_tokens * 10) / 1_000_000).toFixed(4)}`)

  return result.subtitles
    .filter(s => s.text && s.text.trim())
    .map(s => ({ start: s.start, end: s.end, text: s.text.trim() }))
}
