# 306 — harness 把流按 provider 的事件语法收，脚本化的假流一个 delta 就炸

## 现象

把 `runAgentLoop` 换成 pi-agent-core `AgentHarness` 上的一条 lane 之后，原来 24 条用脚本化假流驱动的测试全红，回调里只收到一个 `onError`：

```
HarnessFault: AgentHarness storage or invariant fault
  cause: Error: Assistant message text block 0 has not started
    at encodeTextDelta (pi-ai/dist/utils/assistant-message-frame.js)
    at update (pi-agent-core/dist/harness/runtime/drive/response.js)
    at consumeAssistantStream (pi-agent-core/dist/harness/execution/assistant.js)
```

假流只推 `text_delta` + `done`（或直接 `done`），手写循环从来只看这三种事件，七个测试文件都这么写。

## 原因

harness 把每个流事件编成一帧写进 session 文件（`openFrameProgress`），编码器 `AssistantMessageFrameEncoder` 按真 provider 的语法收事件：先 `start`，每个内容块 `text_start` / `text_delta` / `text_end`（thinking、toolcall 同理），最后 `done` 或 `error`。`consumeAssistantStream` 另有两条硬校验：`start` 之前来任何 update 事件抛 "emitted … before start"，`done` 之前没 `start` 抛 "emitted done before start"。任何一条抛出都走 `onFault`，整个 harness 封死，`lane.prompt` reject 成 `HarnessFault`，真正的原因在 `.cause` 里。

`error` 事件例外：没有 `start` 也收（stream 函数同步抛出时 pi 的 `lazyStream` 就是这么发的）。

## 解法

假流按真 provider 的语法造，收口到 `tests/support/scripted-turn.ts`：`messageEvents(message)` 从最终消息展开整串事件（partial 逐块增长，和 pi 的 faux provider 一样，因为编码器按 partial 里已可见的内容算 delta 偏移），`turnEvents(turn)` 保留原来 `{ text, calls, usage } | { error, reason }` 的脚本形状。新写脚本化的 stream 一律从这里出，别再手推 `text_delta`。

顺带：`reason: "aborted"` 的脚本现在把消息本身的 `stopReason` 也设成 `aborted`，因为 harness 只看结算后的消息，看不到事件上的 reason；真 provider 的 `createAbortedMessage` 本来就是这么标的。
