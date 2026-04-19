# DISCORD_TROUBLESHOOTING.md

## 目的

當 Discord 看起來有連上，但實際沒回應時，用這份快速判斷問題是在：
- 連線層
- 路由/權限層
- 執行環境層

避免把「Discord 已連上但訊息被擋」誤判成「Discord 沒連上」。

## 最短結論

`Discord: OK` 不等於「一定會回訊息」。

要分開看三層：
1. Transport 是否正常（bot/token/連線）
2. Routing 是否正常（policy/allowlist/來源是否被允許）
3. Agent/session 是否正常（有沒有真的收到並處理）

## 標準排查順序

### 1. 先看總體狀態

```bash
openclaw status
```

重點：
- Discord 是否為 `ON / OK`
- Gateway 是否正常
- 服務是否 running

### 2. 再跑 doctor

```bash
openclaw doctor --non-interactive
```

重點找 warning，尤其是這條：

- `channels.discord.groupPolicy is "allowlist" but groupAllowFrom (and allowFrom) is empty`

如果看到這條，代表：
- Discord bot 可能是在線的
- 但群組訊息會被靜默丟掉
- 症狀會像「沒回應」

### 3. 深查 channel 細節

```bash
openclaw status --deep
```

用來確認：
- channel 狀態
- session 是否有建立
- 是否有路由或測試細節可見

### 4. 實測，不要只看狀態頁

實際送兩種訊息：

1. 私訊 bot 一句 `hi`
2. 在目標群組丟一句 `hi`

觀察：
- 私訊有沒有回
- 群組有沒有回
- session 是否更新

## 常見根因

### A. Discord 真的沒連上

症狀：
- status 顯示 Discord 非 OK
- token/config 有錯

處理：
- 檢查 token
- 檢查 channel 啟用狀態
- 重看 `openclaw status --deep`

### B. Discord 有連上，但群組被 allowlist 擋住

症狀：
- status 顯示 Discord OK
- doctor 警告 empty allowlist
- 群組訊息像石沉大海

原因：
```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist"
    }
  }
}
```

但沒有：
- `groupAllowFrom`
- `allowFrom`

處理方式二選一：

#### 方案 1，先恢復可用
```json
{
  "channels": {
    "discord": {
      "groupPolicy": "open"
    }
  }
}
```

#### 方案 2，保留 allowlist 但填完整
```json
{
  "channels": {
    "discord": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["<discord-channel-or-group-id>"],
      "allowFrom": ["<discord-user-id>"]
    }
  }
}
```

關鍵原則：
- `allowlist` 可以用
- 但不能空名單

### C. 本機 shell 找不到 openclaw，但 OpenClaw 本體其實在

症狀：
- 在某些執行環境中 `openclaw: command not found`
- 但使用者終端機中其實可正常執行

這通常是：
- 該執行環境沒有載入正確 PATH
- 不代表 OpenClaw 沒裝，也不代表服務沒起來

處理：
- 先把這件事當成 PATH 問題，不要直接推論為服務故障
- 可改用完整路徑，例如：

```bash
/opt/homebrew/bin/openclaw status
```

## 判讀原則

### 錯誤觀念
- `Discord: OK` = 一定能回訊息

### 正確觀念
- `Discord: OK` 只代表 transport 正常
- 還要再確認 routing 與 session/agent 層

## 建議的固定驗證流程

每次碰 Discord 不回應，固定跑：

```bash
openclaw status
openclaw doctor --non-interactive
openclaw status --deep
```

然後檢查：
- Discord 是否 OK
- 是否有 allowlist 空名單 warning
- 私訊是否正常
- 群組是否正常
- session 是否更新

## 本次事件教訓

這次真正問題不是「Discord 沒連上」，而是：
- Discord transport 正常
- 但 `groupPolicy=allowlist` 且名單為空
- 導致群組訊息被靜默丟棄

因此未來看到「在線但沒回」時，應優先檢查 routing/policy，不要只盯連線狀態。
