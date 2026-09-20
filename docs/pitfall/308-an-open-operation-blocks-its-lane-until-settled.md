# 308 — 上个进程留下的 open operation 堵住 lane，resume 会去调模型，abort 才是不调模型的了结

## 现象

soul 常驻一条 lane（`src/soul/harness.ts`），进程重启后 `createHarness` 重开该组最新的 session。上次进程死在工具执行中间时，`create` 返回的 `open` 列表里有那条 run；不管它，直接在同一条 lane 上 `accept` 新回合，拿到的是 `LaneBusy`：

```
Lane "soul" already has an active operation
```

按 docs/55 写的走 `lane.resume()`：合成的 toolResult（"Tool execution was interrupted…"）是写了，但 resume 接着把这条 run 驱动到底——拿着上一回合的上下文再调一次模型，答案没有任何调用方在听（回调早随上个进程没了），钱照花，还挡在新回合前面。

## 原因

open operation 是 lane 状态的一部分，重开 session 时随分支记录恢复，`state.operation !== null` 就拒绝新的 accept。`resume` 的语义是「把这个 operation 跑完」：先按 replay 策略处理没结果的工具（默认写中断结果，`replay: "safe"` 的重跑），然后继续 drive，下一步就是 assistant 请求。

## 解法

重开时对每条 open operation 调 `lane.abort()` 而不是 `resume()`：`requestAbort` 后 drive 走 recovery 分支，同样写出那条合成的中断 toolResult，然后以 `aborted` 结算，不发请求。之后 lane 空闲，新回合照常 accept。`legion/execute/harness.ts` 的 `rotateSession` 就是这么做的，结算完那个 session 就关掉、另起一个新的；测试在 `tests/legion/execute/held.test.ts`「a tool left running by a dead process…」，断言重启后的进程只有新回合那一次 stream 调用。

要真接着跑的场景（本地 worker 的长任务）才用 resume，而且要先确认它的收件方还在。
