# DISCORD_CONFIG_EXAMPLES.md

## 目的

整理 Discord 常見設定範本，避免出現：
- Discord 顯示已連上
- 但群組訊息被靜默丟棄
- 或者權限開太大，超出原本預期

## 先記住一句

`Discord: OK` 只代表 transport 正常，
不代表群組與私訊一定都會被處理。

真正要檢查的是：
- token/連線
- `groupPolicy`
- `groupAllowFrom`
- `allowFrom`
- 改完後是否真的實測過

---

## 範本 1，先求恢復可用

適合：
- 正在排障
- 想先確認 bot 能正常收群組訊息
- 暫時不想被 allowlist 卡住

```json
{
  "channels": {
    "discord": {
      "groupPolicy": "open"
    }
  }
}
```

### 優點
- 最簡單
- 最不容易出現「看起來在線但沒回」
- 最適合先驗證 routing 是否正常

### 風險
- 群組接收範圍較寬
- 不適合長期放在多人或較複雜環境

---

## 範本 2，推薦的白名單模式

適合：
- 只想讓特定群組、頻道、使用者可觸發
- 想控制暴露面

```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": [
        "YOUR_DISCORD_CHANNEL_OR_GROUP_ID"
      ],
      "allowFrom": [
        "YOUR_DISCORD_USER_ID"
      ]
    }
  }
}
```

### 重點
- `allowlist` 可用，但**不能空名單**
- 如果 `groupPolicy = "allowlist"`，至少要有：
  - `groupAllowFrom`，或
  - `allowFrom`

### 常見錯誤

這種是危險配置：

```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist"
    }
  }
}
```

問題：
- bot 可能在線
- 但群組訊息會被靜默丟棄
- 很容易誤判成「沒連上」

---

## 範本 3，只想先保護群組，但保留特定人可用

適合：
- 不想打開全部群組
- 只允許自己的帳號或少數帳號觸發

```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "allowFrom": [
        "YOUR_DISCORD_USER_ID"
      ]
    }
  }
}
```

### 適用情境
- 私人使用為主
- 先縮小觸發範圍
- 之後再慢慢補 `groupAllowFrom`

---

## 範本 4，短期排障，確認完再收緊

建議流程：

### 第一步，先打開
```json
{
  "channels": {
    "discord": {
      "groupPolicy": "open"
    }
  }
}
```

### 第二步，確認這些都正常
- 私訊 bot 會回
- 群組訊息會回
- session 有更新
- `openclaw doctor --non-interactive` 沒再報空 allowlist

### 第三步，再收緊成白名單
```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["YOUR_DISCORD_CHANNEL_OR_GROUP_ID"],
      "allowFrom": ["YOUR_DISCORD_USER_ID"]
    }
  }
}
```

這樣通常比一開始就硬上 allowlist 更穩。

---

## 改完後的固定驗證方式

每次改完 Discord 設定，固定跑：

```bash
openclaw doctor --non-interactive
openclaw status --deep
```

然後實測：

1. Discord 私訊 bot：
```text
hi
```

2. Discord 目標群組：
```text
hi
```

### 你要確認的點
- Discord channel 狀態是 OK
- 沒有 empty allowlist warning
- 群組訊息不再被靜默丟棄
- session 有建立或更新

---

## 怎麼拿 ID

如果你要填：
- `YOUR_DISCORD_CHANNEL_OR_GROUP_ID`
- `YOUR_DISCORD_USER_ID`

通常做法是先在 Discord 開 developer mode，再複製：
- 使用者 ID
- 頻道 ID
- 群組/伺服器相關 ID（依你的 routing 設計而定）

實際填哪一種，要以你目前 OpenClaw 的 Discord routing 使用欄位為準。

---

## 建議策略

### 如果你現在最重視穩定
建議：
- 先用 `groupPolicy: "open"`
- 確認穩定可收可回
- 再改成 allowlist

### 如果你現在最重視安全邊界
建議：
- 用 `groupPolicy: "allowlist"`
- 但一定要同時填好 `groupAllowFrom` 或 `allowFrom`
- 改完必跑 doctor + 實測

---

## 最後原則

### 不要只看這個
- `Discord: OK`

### 要一起看這些
- transport 是否正常
- routing 是否放行
- allowlist 是否為空
- session 是否真的有更新
- 私訊與群組是否都實測過

如果只看狀態頁，很容易再次掉進「在線，但其實不處理訊息」的坑。
