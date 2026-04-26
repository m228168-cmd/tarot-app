# 偉特塔羅牌查詢 (tarot-app)

線上查詢偉特塔羅 78 張牌牌意，可以針對自己的解讀風格修改每張牌的正位／逆位文字，每台裝置各自存自己的版本，並自動雲端備份。

線上版：https://tarot-app-one-mu.vercel.app

## 功能

- **78 張完整牌組**：大阿爾克那 22 張、小阿爾克那 40 張、宮廷牌 16 張，內建偉特牌圖（本機持有，不依賴外部連結）。
- **關鍵字搜尋**：可以用中文牌名、英文名、或牌意關鍵字（例：愚者、The Fool、轉機、重生）找到對應的牌。
- **編輯自己的牌意**：每張牌的正位／逆位都可以改，存的是這台裝置的版本，不會影響別人。
- **回復原始牌意**：單張牌可以一鍵還原成預設版本。
- **本機變更紀錄**：每張牌最多保留 20 筆編輯紀錄。
- **雲端備份**：每次儲存會把這台裝置的版本寫到 Vercel Blob（private），含 deviceId 分組，方便事後找回。
- **Admin 備份頁**：`/admin.html` 列出雲端所有裝置的備份，支援下載單張牌或整台裝置的覆寫資料。

## 技術棧

- React 19 + Vite 8
- 純 localStorage 存使用者修改版本（`tarot-card-overrides`、`tarot-card-history`、`tarot-device-id`）
- Vercel Serverless Functions (`api/`) + Vercel Blob 做雲端備份
- 部署在 Vercel

## 專案結構

```
tarot-app/
├── api/                       # Vercel Serverless Functions
│   ├── save-override.js       # 寫入單張牌的覆寫到 Blob
│   ├── get-override.js        # 讀單張牌的覆寫
│   └── list-overrides.js      # 列所有裝置的備份（給 admin 用）
├── public/
│   └── cards/                 # 偉特牌圖（本機持有）
├── src/
│   ├── App.jsx                # 主查詢介面
│   ├── Admin.jsx              # 備份管理頁
│   ├── data/tarotCards.js     # 78 張牌的預設牌意
│   └── ...
├── index.html                 # 主頁
├── admin.html                 # 備份管理頁入口
└── vercel.json                # Vercel 部署設定
```

## 開發

```bash
npm install
npm run dev        # 本地開發
npm run build      # 打包到 dist/
npm run preview    # 預覽 build 後的版本
npm run lint       # ESLint 檢查
```

## 資料儲存

- **localStorage**：每台裝置存自己的牌意覆寫版本與變更紀錄，清掉瀏覽器資料就會還原成預設。
- **Vercel Blob (private)**：路徑為 `overrides/{deviceId}/{cardId}.json`，由 `api/save-override.js` 寫入，admin 頁面可以列出與下載。

## Changelog

詳見 [`CHANGELOG.md`](./CHANGELOG.md)。
