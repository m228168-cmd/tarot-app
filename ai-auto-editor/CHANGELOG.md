# Changelog — ai-auto-editor

格式：`YYYY-MM-DD | 改了什麼 | 為什麼改`

---

## 2026-04-07
- 建立 CHANGELOG.md，開始正式記錄變更

## 歷史紀錄（從 git log 重建）

### 2026-04-03 ~ 04-07
- 建立專案骨架
- 整合 Google Drive API 認證與檔案列表
- 加入上傳與 transcript 流程
- 打通 Google Drive 下載流程，成功下載素材至 downloads/raw/
- 加入下載任務狀態追蹤（pipeline:download-latest:task）
- 新增 recover-task-from-log.js 修正任務狀態不同步問題
- 安裝本機 openai-whisper + torch
- 修正 transcribe.js 改用本地 whisper CLI
- 完成完整 rough cut pipeline：
  - 自動剪除較長空白
  - 保留完整節目內容
  - 輸出 soft-sub MP4（內嵌可切換字幕）
  - 上傳回 Google Drive output 資料夾
- 最後成品 fileId: 1lN-eNrsjDCCf--DEUjZ7QTl9HSTjC_TT
