# pi-durable 重开后把杀在半句的回答从零重问，已提交的半句只在 pi.live 里挂到重问提交

## 现象

pi-durable 1.1.0 spike（`tests/legion/durable/crash.test.ts`）：流式回答写到两百多字时 SIGKILL，重开同一个 JSONL 目录。

- 重开那一刻 `viewState().value.docs["pi.live"].generation.message` 里是杀之前最后一次提交的半句（按 100ms 节拍，最多丢一个窗口）。
- `harness.resume()` 之后 generation 发的是一次全新请求，`context.messages` 是 `["system", "user"]`，半句不带上去。
- 半句一直挂在 `pi.live` 里，直到重问的第一次提交把它换掉；最后落进 transcript 的 `pi.assistant` 只有重问的那份回答，半句不进 transcript。

和 0.87 的行为相反：坑 395 里 pi 把半句拼成一条 `stopReason: "error"` 的消息结算掉，不再请求。

## 原因

`pi.live` 是 `history: "latest"` 的文档，只存在途状态；generation 任务的 checkpoint 只记到「在请求」，没有「已收到哪些 token」。恢复时任务从 checkpoint 重跑这一步，请求重发，provider 侧不存在续写。

## 解法

把 `pi.live` 里的半句当临时稿：重开后显示它可以，但不落进对话文件，也不和重问的回答拼接。重问会再花一次完整的输出 token。要「已写的字还在」就得自己在重开时把半句另存成一条 entry（比如 `app.interrupted-draft`），pi-durable 不替你做。
