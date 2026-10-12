# pi-ai 把抛出物变成 error 消息，只留文字

## 现象

回合和后台运行搬上 pi-durable 后，蒸馏失败的 `distill-failed` 事件里 `errorName` 一律是 `Error`，断网和没登录分不出来。

## 原因

pi-ai 的 `models.streamSimple` 不往外抛：凭据解析抛出的错、provider 里 fetch 抛出的错，都变成 `stopReason: "error"` 的 assistant 消息，只有 `errorMessage` 一个字符串，`diagnostics` 也是空的。实测（2026-10-12，pi-ai 1.1.0）：auth 的 `resolve` 抛出自定义类，消息是 `API key auth failed for provider anthropic: <原消息>`；连一个拒绝连接的端口，消息是 `Connection error.`。pi-durable 再把这条消息原样落进条目，类没有地方可放。

## 解法

`src/ai/provider-failure.ts` 的 `providerFailureName` 按文字映射回固定的名字（`NotSignedInError`、`OfflineError`、其余 `ModelCallError`），`legion/durable/background.ts` 的 error 结局带上它。pi-ai 的错误文案变了要跟着改这里的正则，`tests/ai/provider-failure.test.ts` 里放的是实测到的原文。
