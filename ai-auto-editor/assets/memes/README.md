# 梗圖素材庫 (Meme Library)

供自動剪片 pipeline 依對話 transcript 內容自動挑圖使用。

目前已清空示範素材，改為讓你自行放入自己的迷因檔案。

## 目錄結構

```
assets/memes/
├── index.json      # 素材索引（主資料）
├── schema.json     # JSON Schema 驗證規格
├── README.md       # 本說明文件
└── *.png           # 梗圖素材檔案（1:1 正方形優先）
```

## 素材規格

- **格式**：PNG（透明背景優先）或 JPG
- **尺寸**：建議 512×512 或 1024×1024（1:1 正方形）
- **命名**：kebab-case，與 `index.json` 中的 `id` 一致

## index.json 欄位說明

| 欄位 | 類型 | 說明 |
|------|------|------|
| `id` | string | 唯一識別碼（kebab-case） |
| `file` | string | 檔案名稱 |
| `label` | string | 中文顯示名稱 |
| `tags` | string[] | 分類標籤（反應、比較、動物…） |
| `moods` | string[] | 情緒標籤（英文，供 AI 語意匹配） |
| `triggers` | string[] | 觸發關鍵字（中文，從 transcript 直接比對） |
| `aspectRatio` | string | 素材比例（1:1 / 4:3 / 16:9 / 9:16） |
| `source` | string | 來源說明 |
| `license` | string | 授權類型 |

## 自動匹配邏輯（規劃中）

1. **關鍵字匹配**：逐句掃描 transcript，比對 `triggers` 欄位
2. **語意匹配**：透過 AI 分析句意，比對 `moods` 欄位
3. **排序**：同時命中 trigger + mood 的素材優先

## 新增素材

1. 將圖片放入 `assets/memes/`
2. 在 `index.json` 的 `memes` 陣列中新增一筆
3. 在 `sources.json` 補上對應來源 URL / 狀態
4. 確保填寫所有 required 欄位
5. 執行 `npm run memes:bootstrap` 檢查缺檔與來源覆蓋率
6. 可用 `schema.json` 驗證格式

## Bootstrap / 驗證

目前先採 **可追溯來源 + 本地落地素材** 的策略，不做無白名單亂爬。

- `assets/memes/sources.json`：素材來源與狀態追蹤
- `npm run memes:download`：下載 `sources.json` 中已具備 URL 的素材
- `npm run memes:bootstrap`：檢查 index / source / 實體檔是否對齊

建議流程：
1. 先補 `sources.json` 的明確 URL
2. 下載圖片到 `assets/memes/`
3. 跑 `npm run memes:bootstrap`
4. 再做 rerun 驗證

## 版權注意

- `cc-*`：Creative Commons 授權，可優先列入安全白名單
- `fair-use-meme`：網路廣泛流傳的 meme，保留為 legacy 類，不列入自動補圖白名單
- `original`：自製素材
- 若版權存疑，請標註 `unknown` 並在 `source` 欄位詳述來源
- 本庫採兩層：
  - `safetyTier: "safe"`：可追溯、可自動下載、可穩定重跑
  - `safetyTier: "legacy"`：可保留 metadata，但不作為自動抓圖目標
