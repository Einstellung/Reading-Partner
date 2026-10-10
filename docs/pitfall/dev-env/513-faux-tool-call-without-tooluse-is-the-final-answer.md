# pi-ai 的 faux 回复带了工具调用但没写 stopReason，pi-durable 当它是最终回答，工具不跑

## 现象

pi-durable spike 的第一版测试：`fauxAssistantMessage([fauxText("Let me check."), fauxToolCall("lookup", …)])`，submission 照样 `done`，transcript 里只有 `pi.user`、`pi.system`、`pi.assistant` 三条，没有 `pi.tool-result`，工具一次没调，也没有任何报错。

## 原因

`fauxAssistantMessage` 的 `stopReason` 默认是 `"stop"`。pi-durable 的 generation 按 `stopReason` 决定是否进工具轮，不看 content 里有没有 `toolCall`；`"stop"` 就结算成最终回答。

## 解法

带工具调用的 faux 回复写 `fauxAssistantMessage([...], { stopReason: "toolUse" })`。断言 transcript 的条目种类，别只断言 submission 的 status。
