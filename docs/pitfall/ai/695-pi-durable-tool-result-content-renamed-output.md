# pi-durable 1.5 工具结果的 content 改名 output，旧字段被静默丢掉

## 现象

升到 pi-durable 1.5.0 后，typecheck 通过，所有工具都照常执行，但模型收到的 `toolResult` 是空的（`"toolResult:"`）。子 agent 的简报、`read_pages` 的页文、后台 pass 的查表结果都带不回去。

## 原因

`ToolExecutionResult` 的模型可见内容从 `content` 改名 `output`（省略时取 `api.output()` 留下的文字）。`src/legion/durable/tools.ts` 的 `toolContent` 没写返回类型，返回 `{ content }` 不触发多余属性检查，pi 读不到 `output` 就当空结果。

## 解法

`toolContent` 返回 `{ output }`，并标注返回类型 `ToolExecutionResult`，以后再改名会在 typecheck 里报。
