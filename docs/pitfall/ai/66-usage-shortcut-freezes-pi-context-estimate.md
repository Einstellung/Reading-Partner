# 一旦有真 usage，pi 的上下文估算就冻住：改前缀不算数

## 现象

agent loop 从第二轮起，往消息数组里 push 的是 pi 给的真 `AssistantMessage`（带 `timestamp` 和 `usage`）。从那一刻起：

- pi 对整个上下文的估算 **等于那条 usage 的 totalTokens**，系统提示词一个 token 都不算。40000 字符的系统提示词（pi 自己算 10000 token）加一条 usage=150000 的 assistant 消息，pi 报 150000，不是 160000。
- 把 usage 那条之前的东西压缩掉，pi 的数字 **一动不动**。20 万字符的 tool result 换成一行存根，pi 前后都报 150000。省下的 5 万 token 对 `clampMaxTokensToContext` 不存在。
- 同样的压缩放在 usage 那条之后，正常生效（195903 → 150002）。
- 重放历史里只要有一条没有 `timestamp` 的 assistant 消息（`toPiMessages` 就是这么产的，见坑 64），捷径整个不触发：同一个上下文报 10006 而不是 150000，差 15 倍。

后果：新开的 AI 笔气泡（历史里没有旧 AI 回合）和续聊的线程，走的是两套完全不同的计价方式，而调用点看起来一模一样。

## 原因

`dist/utils/estimate.js` 的 `estimateMessages` 找最后一条"可用"的 assistant 消息（`timestamp >= 之前所有消息的最大 timestamp`、`stopReason` 不是 aborted/error、`totalTokens > 0`），找到就返回 `usage + 它之后那些消息的估算`，前缀里的一切——包括系统提示词和工具 schema——都不再单独计算。usage 描述的是**已经发出去的那一次请求**的前缀，所以它天然不会因为你事后改写历史而变小。

没有 timestamp 那条的效果是数值事故：`latestPrefixTimestamp = Math.max(latestPrefixTimestamp, undefined)` 得到 NaN，之后每次 `timestamp >= NaN` 都是 false，捷径永久关闭。

## 解法

不要用"当前 used 减去某一档的 saving"来判断压缩够不够。压缩阶梯的 saving 只能按字符估（`src/budget/estimate.ts`），而 `used` 从第二轮起来自 pi 的 usage，两者不同币种，减法没有意义。

`src/ai/agent.ts` 的做法是：真的把那一档应用掉，然后重新量一次 `contextBudget`。两个估算各自在自己的币种里重算，取大值。

同时要接受它的代价，别指望压缩每次都管用：usage 之前的东西压了也不减 pi 的数，所以中途存根只在"字符估算是那个卡住的数"时救得回来（中文场景，也正是 `src/budget` 存在的理由），外加当前这一轮的 tool result（它们在 usage 之后，正常计算）。如果卡住的是 pi 自己的数，改历史没有任何用——pi 照那个数夹——直接拒绝才是对的结果。
