# AI Auto Editor

AI 自動剪輯新專案。

## 目標

做一個能幫使用者：

- 上傳影片 / 音訊
- 自動語音轉文字
- 找停頓、空白、贅段
- 整理重點
- 生成字幕
- 提供剪輯建議

## MVP 功能

1. 上傳影片 / 音訊
2. 抽音訊
3. Whisper 逐字稿
4. silence detect 偵測空白
5. 輸出字幕檔（srt / vtt）
6. 產生剪輯建議清單
7. 顯示重點摘要

## 後端流程

1. 使用者上傳素材
2. ffmpeg 抽音訊
3. Whisper 產生 transcript
4. 偵測停頓 / 空白
5. 整理重點
6. 生成：
   - transcript.json
   - subtitles.srt
   - cut-suggestions.json
   - summary.json

## 第一版先不做

- 內建時間軸編輯器
- 多軌剪輯
- 社群一鍵發布
- 花式字幕樣式編輯
- 視覺特效

## 開發優先順序

### Phase 1
- 上傳素材
- 逐字稿
- 字幕輸出

### Phase 2
- 停頓偵測
- 剪輯建議

### Phase 3
- 重點摘要
- 精華片段

### Phase 4
- 自動輸出剪好的影片
