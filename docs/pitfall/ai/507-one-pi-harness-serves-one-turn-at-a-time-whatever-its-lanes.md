# 一个 pi harness 同一时刻只能跑一个回合，开几条 lane 都一样

## 现象

想让两个对话的 soul 回合并行，在 soul 的 harness 上给每个对话开一条 lane。两个回合同时跑时，各自的 provider 请求拿到的是后进来那个回合的工具表和 system prompt，hook 和事件监听也互相听得到。

## 原因

pi 0.87 的 `Harness` 管 lane 但不是 lane：工具表、`systemPrompt`、`toProviderMessages`、`streamOptions` 放在 harness 的 `configStore` 里，每轮请求现读（`drive/generation.js`），对它上面所有 lane 生效；`Models` 也是 harness 级的。`hooks` 和 `events` 一个 harness 一份，`before_request`、`message_update`、`tool_start` 对每条 lane 都触发。`held.ts` 的 turn slot 只能装一个回合，原来"一条 lane 严格串行"其实是这个限制。

## 解法

一个对话一个 pi harness，各管一条 lane，共用同一个 `Session`（`harness.ts` 的 `attachHarness`）。session 的写入走它自己的 `MutationLine`，哪个 harness 发起都逐个落盘；lane 的值按名字分开存。一条 lane 只能由一个 harness 驱动：harness 把 lane 状态缓存在内存里，看不到别的 harness 的改动。闲下来的 harness 直接丢掉，下次重新挂一个，它在挂上时从 session 读回 lane 状态。`close` 任何一个都会关掉共用的 session，只在整体关闭时关。测试：`tests/legion/execute/held-lanes.test.ts`（两个对话同时跑、session 重启后完整打开）。

关联坑：307。
