# pi 0.87 把系统提示词折进了消息列表，`context.systemPrompt` 悄悄变成 undefined

## 现象

升到 pi-ai 0.87.1 之后，读 provider 收到的 context 的测试全部错位，而且不报类型错：

- `context.systemPrompt` 永远是 `undefined`，`String(context.systemPrompt ?? "")` 得到空串，
  断言 `toContain("daily briefing")` 收到 `""`。
- `context.messages[0]` 不再是调用方的第一条消息，而是一条 `role: "system"`；
  按下标取第一条用户消息的断言读到的是系统提示词。
- `context.tools` 也是 `undefined`。

## 原因

0.87 加了 `normalizeContext()`，它把 `Context.systemPrompt` 和 `Context.tools`
折进一条打头的 system 消息，产出带 brand 的 `TranscriptContext`；provider 面的每个
入口（`streamSimple`、`clampMaxTokensToContext`、`buildBaseOptions`）都只收后者。
`Context` 的三个字段都还在类型里，只是到了 provider 手上全空——所以读它们编得过、跑不对。

`SystemMessage` 同时成了 `Message` 联合的一支，`content` 是 `string | TextContent[]`，
还带 `sections`、`toolsAdded`、`toolsRemoved`。遍历消息内容块的代码要先把这一支分出去。

## 解法

发送路径在进 provider 前调一次 `normalizeContext({ systemPrompt, messages })`
（`src/ai/providers.ts` 的 `streamChatCore`、`src/budget/estimate.ts` 的 `piBudget`），
自己的流契约（`SimpleStreamFn`、`legion/execute/contract.ts` 的 `StreamFn`）改收
`TranscriptContext`。

读 transcript 一律用 pi 的 helper，不要按下标猜：`withoutInitialSystemMessage(messages)`
拿调用方的消息，`getCurrentSystemPrompt(messages)` 拿提示词，`getCurrentTools(messages)`
拿工具清单。
