# 368 — run 开着的时候 appendCustomEntry 只入队，findEntries 立刻查是查不到的

## 现象

恢复上个进程没跑完的 soul 回合时，要在 resume 之前记一条「试过一次」，免得一条每次都把进程跑死的回合被无限重试（坑 308）。按 `lane.appendCustomEntry("reading-partner.recovery-attempt", …)` 写，然后 `lane.findEntries({ customType })` 数——数出来是 0。那条 run 还开着。

## 原因

`AgentLane.append`（`harness/runtime/lane.js`）看 `state.operation`：为 null 才把 entry 挂到 branch tip 上提交；不为 null 就只写两个 value（`pendingEntry(id)` 存 payload，`laneStateValue` 存把它加进去的 inbox），排进 lane 的 write 队列，等 run 跑到一个 drain 边界（下一次 assistant 请求之前）才真正落成 entry。`findEntries` 扫的是 branch 上已提交的 entry，所以这段窗口里它看不见。两处都在 session 文件里，进程再死也不丢——它只是还不是一条 entry。

## 解法

数的时候把队列一起数：`lane.watch()` 的快照一次给全（`transcript` 是这条分支已提交的 entry，`queues` 是 inbox 里 `{ kind: "write", type: "custom", customType }` 的那些），读完立刻 `unsubscribe()`。`src/soul/recover.ts` 的 `finishRun` 就是这么数的，只读 transcript 的话，每次都死在模型调用之前的那条回合永远是「试过 0 次」，每次启动都会再 resume 一遍。

投递地址那条（`reading-partner.delivery`）没有这个问题：它写在 accept 之前，lane 上没有 operation，当场就是一条 entry。
