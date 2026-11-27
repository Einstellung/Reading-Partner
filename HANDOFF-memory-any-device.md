# 交接：记忆整理在任何设备上跑（feat/memory-any-device）

## 已做（三个 commit）

1. 逻辑：每台设备跑 daily round（`src/presence/live.ts` 的 `startDailyRound`，由 `useBackgroundServices` 起，两个壳都走）。dream 当晚第一台跑：`src/memory/dream/runs.ts` 的 `dream-runs/<deviceId>.json`（palace 行 `dream-run`，sync data），判据 `schedule.ts isDreamDue(latest, now)` = 最近一个已过去的 3 点之后没人跑过。round 等 `platform/sync/first-pass.ts` 的首个 pass（`firstSyncPassSettled` / `markSyncEdge`）和读者停手（`legion/durable/stall.ts` 新加的 `activity()`，3 分钟没有新回合）。runner 的 synced run 谁先看到谁做（`legion/schedule/due.ts`，别人的 run 一天没动静才接手 `ABANDONED_MS`），轮询等首个 pass。nightly job 等首个 pass（`tick.ts` 的 `ready`）。schedule 不再选机器。手机壳起欠账扫（`sweepCadence("phone")`：只在前台、60 分钟）。
2. 删除：`src/legion/claim` 整个、`presence/session.ts`、`WorkerRegistration.requires`、三餐配图的 `WEBVIEW_FETCH` 标签（它是 local 档，自己查 `hasWebviewFetch`），status 不再读 claim。claim 的 palace 行改为 `claim-legacy`、sync local。
3. 文档：48、55、59、legion-rest。

## 还剩

- `src/platform/app/device.ts` 的 `DeviceRole` / `role` / `deviceRoleFor` / `roleIsChoosable` / `currentDeviceRole` 和 `backgroundCollect` 已无消费者（只剩设置页和 device 的迁移与测试）：删掉，连同 `FeaturesPanel.tsx` 的「briefing / collect」段和角色选择、9 种语言里 `settings.features.briefing|collect|collectHint|role|roleHint` 等键。删前 grep。单独一个删除 commit。
- `grep -rn "collector" src` 里剩下的过时注释顺手改。
- 没跑 xvfb 起 app 看 daily round 日志。
- 没记坑（713、714 未用）。

## 风险

- `initSync` 在设 `graceSince` 之前抛错时，`firstSyncPassSettled` 一直是 false，这次会话里 dream、synced run、nightly job 都不跑。
- 旧版桌面（0.28 及以前）还会自己选自己跑 dream，和新版设备并存期间一晚可能跑两次。
