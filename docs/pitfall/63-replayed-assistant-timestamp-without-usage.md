# 给重放的 assistant 消息补一个 timestamp，全 app 的 AI 当场全死

现象：给 `src/ai/providers.ts` 的 `toPiMessages` 里那条重放的 assistant 消息加上 `timestamp`（看起来只是补全一个字段，`UserMessage` 和 `ToolResultMessage` 都有），之后每一次 AI 调用——聊天、备课、笔记、幻灯片、新闻三选一、记忆蒸馏——在还没发出请求之前就抛 `TypeError: undefined is not an object (evaluating 'usage.totalTokens')`。第一轮对话不受影响（历史里还没有 assistant 消息），第二轮开始必死。

原因：pi 每次调用都会估算上下文占用。`buildBaseOptions`（`dist/api/simple-options.js`，三家 provider 的 `streamSimple` 都走它）用 `clampMaxTokensToContext` 把 `maxTokens` 夹到剩余窗口里，它调 `estimateContextTokens` → `getLastAssistantUsageInfo`：

```js
const usageAppliesToPrefix = assistant.timestamp >= latestPrefixTimestamp;
if (usageAppliesToPrefix && assistant.stopReason !== "aborted" && ... &&
    calculateContextTokens(assistant.usage) > 0)   // usage.totalTokens
```

`AssistantMessage` 的 `usage` 在类型上是必填的，pi 只在自己产出的消息上构造它，所以这段代码不做任何存在性检查。我们重放的历史是手写的 `{ role, content }` 再 `as unknown as Message` 骗过类型，两个字段都没有。今天不炸纯属两个 undefined 互相抵消：`undefined >= x` 是 `false`，短路在读 `usage` 之前；再往后 `Math.max(latestPrefixTimestamp, undefined)` 变成 `NaN`，后面所有比较也都是 `false`。补上 `timestamp` 就把这道短路拆了，`usage` 直接被解引用。实测（pi-ai 0.82.1）：不带 timestamp 返回 64000，带 timestamp 不带 usage 抛 TypeError。

解法：`toPiMessages` 的那条 `return` 上方写死了警告，改它之前先读本篇。真要补字段就两个一起补——`timestamp` 和一个零值 `usage`（`input/output/cacheRead/cacheWrite/totalTokens` 全 0 加 `cost` 全 0），零值让 `calculateContextTokens(...) > 0` 为假，估算退回逐条文本估算，也就是今天的行为。只补一个不如一个都不补。

顺带记住这条形状：`as unknown as Message` 骗过去的地方，类型必填的字段在运行期是缺的，而库按类型写代码。这里刚好缺得对，下一次未必。
