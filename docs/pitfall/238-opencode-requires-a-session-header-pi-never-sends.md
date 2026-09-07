# OpenCode 要一个 pi 从来不发的头，缺了就整轮 400

## 现象

选 OpenCode Go 之后每一次调用都失败，聊天里是一整轮红：

```
OpenAI API error (400): {"type":"MissingSessionID","message":"Error from provider (Console Go): Request is missing x-opencode-session and cannot be routed efficiently. Please see https://opencode.ai/docs/go/#where-can-i-use-it"}
```

换模型、换 key、重登都一样，别的 provider 全正常。

## 原因

OpenCode 要求每个请求带 `x-opencode-session`，值是一个会话内稳定的 id，它拿来做路由和 prompt cache 命中。pi-ai 不知道这个头：`grep -rn "opencode-session" node_modules/@earendil-works/pi-ai/dist/` 一条都没有，0.85.1 已是最新版，升级不解决。pi 自己的 `options.sessionId` 不是这个东西——它按 `compat.sessionAffinityFormat` 发 `session_id` / `x-client-request-id` / `x-session-affinity` / `x-session-id`，而且要 `compat.sendSessionAffinityHeaders` 打开才发。

## 解法

`ProviderRequestOptions.headers`：openai-completions、openai-responses、anthropic-messages 三个 api 都把它 merge 在最后，调用方的值盖过 provider 默认值（`null` 还能删掉一个默认头）。

映射表放 `src/ai/call-setup.ts`，一个 provider 一行，`opencode-go` 和 `opencode` 各一条。id 用会话 id，不是每次调用一个随机值——随机值也能让 400 消失，但把这个头存在的理由（路由和缓存）扔了。工具循环用 `TurnTelemetry.thread`，`runAgentTurn` 本来就为每一轮解析好了它，一次解析同时喂给埋点和这个头，于是一轮里的每个 round、同一会话的连续几轮，发出去的是同一个值；`streamChat` 由调用方传 `sessionId`，今天三个调用方都没有会话，各自现取一个新 id 并在调用点写明这是一次性调用。

头要在知道 provider id 的地方决定（`streamChat` / `runAgentTurn`），当数据往下传给 stream；`streamChatCore` 和 `runAgentLoop` 是注入式的，在里面查表测试就看不见。不要塞进 `src/ai/fetch-bridge.ts`：它按 host 分发，不知道一个请求属于哪个会话，放那儿只能给一个进程级常量，稳定性就没了。

## 实测

拿到 key 后对 `opencode-go` 打过真服务：

- `POST https://opencode.ai/zen/go/v1/chat/completions` 不带头，400 `{"type":"MissingSessionID", ...}`，和用户报的那条一模一样。
- 同一个请求加 `x-opencode-session: thread-abc123`，200，正常补全。
- 走本 app 的映射表加 pi 的 `opencode-go` provider，`qwen3.8-flash` 上跑通两轮工具循环，工具调用也正常。这个模型解析到 pi 的 **anthropic-messages** api，所以 `options.headers` 这条路在 openai-completions 之外也确认可用。

OpenCode Zen（`opencode`）仍然没测：那个 workspace 余额不足，在任何 session 检查之前就回 `CreditsError`，所以 Zen 那一条到今天依然只有文档支撑。
