# Changelog — tarot-app

格式：`YYYY-MM-DD | 改了什麼 | 為什麼改`

---

## 2026-04-07
- 建立 CHANGELOG.md，開始正式記錄變更

## 歷史紀錄（從 git log 重建）

### 2026-04-03 ~ 04-07
- 完成大阿爾克那、小阿爾克那、宮廷牌資料與偉特牌圖
- 圖片改為本機持有，不依賴外部連結
- 加入 localStorage A 方案：每台裝置存自己的牌意編輯版本
- 加入單張牌回復原始版本功能
- 加入本機變更紀錄
- 建立 admin 備份頁、雲端備份 API
- 修正 admin 裝置分組與 private blob 讀取流程
- 部署至 Vercel：https://tarot-app-one-mu.vercel.app
