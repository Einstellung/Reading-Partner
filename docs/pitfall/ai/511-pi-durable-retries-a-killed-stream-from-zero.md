# pi-durable 重开后把杀在半句的回答从零重问，半句以 aborted 的 pi.assistant 留在 transcript 里

## 现象

pi-durable 1.1.0 spike（`tests/legion/durable/crash.test.ts`）：流式回答写到两百多字时 SIGKILL，重开同一个 JSONL 目录。

- 重开那一刻 `viewState().value.docs["pi.live"].generation.message` 里是杀之前最后一次提交的半句（按 100ms 节拍，最多丢一个窗口）。
- `harness.resume()` 之后 generation 发的是一次全新请求，`context.messages` 是 `["system", "user"]`，半句不带上去。
- 半句一直挂在 `pi.live` 里，直到重问的第一次提交把它换掉。
- 结算后 transcript 是 `pi.user`、半句的 `pi.assistant`（`stopReason: "aborted"`）、重问的完整 `pi.assistant`。半句不进下一次请求的上下文。JSONL 和 SQLite 后端一样（2026-10-10 复测：JSONL 236 字、SQLite 在 Tauri app 里 288 字；本坑初版说「半句不进 transcript」是错的，当时只断言了最后一条）。

和 0.87 的行为相反：坑 395 里 pi 把半句拼成一条 `stopReason: "error"` 的消息结算掉，不再请求。

## 原因

`pi.live` 是 `history: "latest"` 的文档，只存在途状态；generation 任务的 checkpoint 只记到「在请求」，没有「已收到哪些 token」。恢复时任务从 checkpoint 重跑这一步，请求重发，provider 侧不存在续写。

## 解法

回合结束投影到对话文件时按 `stopReason` 过滤：`aborted` 的那条是被杀的半句，不和重问的回答拼接；要保留就从这条取，不用自己另存。重问会再花一次完整的输出 token。
