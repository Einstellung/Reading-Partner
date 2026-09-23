# 接受 prompt 时 harness 把重放的历史逐条当消息播出来，埋点记成一堆幽灵调用

现象：`events-ai.jsonl` 里一次讲课回合的两条正常 `prompt-cache` 行（round 1、round 2）之前，多出 19 行 `round: 0`、`input/cacheRead/cacheWrite/output` 全 null、`sinceMs` 为 0、`ms` 等于 Unix 时间戳（`startedAt` 还是 0，`endedAt - 0` 就是当前时刻）的行，19 行彼此相差不到 2 毫秒。同一现象在 `surface=info` 和 `surface=bell` 上也有，条数随会话长短变（19/18/17/16/13），子 agent 的行从来不带。

原因：pi-agent-core 为它写进 session 的每一条消息发一次 `message_end`（`harness/runtime/transcript.js` 的 `entryLifecycleEvents`），不只为模型答回来的那条。一个回合的 prompt 是整段对话（`toPiMessages` 重放的历史 + 这次的提问），`lane.accept` 把它们逐条写进 session，于是第一个请求发出去之前就播出了一串 `message_end`，其中每条重放的 assistant 消息 role 都是 `"assistant"`。`turn.ts` 的监听器只看 `recovery` 和 `role`，把它们全当成一轮记进两个 sink，而此时 `round` 和 `startedAt` 都还是 0。

解法：按 run 分辨，不按 role。harness 流出来的消息带发起它的 operation id（`message_end` 的 `runId`），只写进 session 的消息不带；`turn.ts` 只在 `runId` 等于本回合 `accept` 拿到的 `operationId` 时才记一轮。

读日志时另记一条：`model-calls-*.jsonl` 的同一批幽灵只留下 1 行——这是并发写互相覆盖的另一个坑，见坑 338。两个 sink 行数对不上不代表只有一个 sink 出错。
