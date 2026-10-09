# requestAbort 之后 pi 仍等着正在跑的工具，工具不认 signal 就永远不结算

## 现象

工具执行中按停止，或停摆计时器、回合时限到点，回合不结束：lane 一直占着，同一对话后面的回合全停在 Thinking。只在工具卡住（网络请求不返回）时出现，工具正常返回的话停止看起来是好的。

## 原因

`lane.requestAbort` 会 abort 交给工具的 `context.abortSignal`（`execution/tools.js` 的 `executeToolCall`），然后照样 `await tool.execute(...)`，等它返回才把 run 结算成 aborted。我们的 `AgentTool.execute(args)` 不收 signal，工具根本不知道被停了。

## 解法

`turn.ts` 的工具适配层拿 pi 给的 `context.abortSignal` 和工具的 promise 赛跑：只读工具在 abort 时直接放手，抛错让 pi 记一条错误结果，run 随即结算、lane 交还，工具自己在后台跑完没人管。写工具照旧等它返回，否则写入会在回合结束后落地，没人看到回执。读者自己按的停止不发 `onToolEnd`，停摆和时限发一条红色结束行。测试：`tests/legion/execute/turn-limit.test.ts`（去掉赛跑两个用例都卡死）。

关联坑：390、491。
