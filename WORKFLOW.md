# WORKFLOW.md — 做事規範

## Commit 規則

每個 commit 訊息必須加前綴，讓 git log 一眼看出是哪個專案：

```
[tarot]  修正手機版牌義顯示
[editor] 修正轉錄任務狀態同步
[infra]  更新 .gitignore、workspace 設定
```

## 修改流程

1. **改前先確認** — 讀懂現有程式碼再動，不要亂猜
2. **改完先測** — 本機確認功能正常再 commit
3. **commit 前更新 CHANGELOG** — 在對應專案的 CHANGELOG.md 補一行：
   ```
   YYYY-MM-DD | 改了什麼 | 為什麼改（問題根源）
   ```
4. **commit 後 push** — 每次作業完一定要 push，保持 GitHub 同步

## CHANGELOG 用途

- 快速找問題根源：「這個功能是哪天改的、為什麼改」
- 接手時快速上下文（本次建立的原因）
- 未來 debug 時對照 git diff

## 絕對不 commit 的東西

- `credentials.json`、`token.json`、`.env`（已加入 .gitignore）
- 大型 binary 檔（影片、未壓縮圖片）

## 專案路徑

| 專案 | 路徑 | 線上 |
|------|------|------|
| tarot-app | `/Users/m2281682/.openclaw/workspace/tarot-app` | https://tarot-app-one-mu.vercel.app |
| ai-auto-editor | `/Users/m2281682/.openclaw/workspace/ai-auto-editor` | 本機 pipeline |

## Git Remote

- Repo 根目錄：`/Users/m2281682/.openclaw/workspace`
- Remote：`https://github.com/m228168-cmd/tarot-app.git`
