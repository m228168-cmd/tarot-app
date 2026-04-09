#!/bin/zsh
set -e

cd /Users/m2281682/.openclaw/workspace/ai-auto-editor

if [ ! -d node_modules ]; then
  echo "[ai-auto-editor] 安裝依賴中..."
  npm install
fi

# 若已有 vite 在跑，盡量不重開
if ! lsof -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ai-auto-editor] 啟動審稿工作台..."
  nohup npm run dev -- --host 127.0.0.1 > /tmp/ai-auto-editor-review.log 2>&1 &
  sleep 2
else
  echo "[ai-auto-editor] 偵測到 5173 已在執行，直接開啟頁面"
fi

open "http://127.0.0.1:5173/#/review"
