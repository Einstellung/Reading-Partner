# iOS 把 app 冻住之后，那条流不报错也不结束，占着 lane 把后面的消息全卡住

## 现象

iPad 上正在出一个带 `read_pages` 的长回合，中途切走或锁屏，一两分钟后回来：那条回复停在半句上再也不动。用户发「你继续回答一下」，消息画在屏幕上带一个"排队中"的标记，然后什么都不发生——没有回复，没有报错，没有 Retry。第二次催才可能有反应（实际是 app 被杀过一次，重启清掉了内存里的登记）。

用户的线程文件里留下四处「用户连发两三条中间没有 AI 消息」，每处前一条 AI 回复都是带工具的长回合。

## 原因

app 没有 `UIBackgroundModes`。切走几秒后进程被冻结，那条流式 HTTP 连接在解冻时已经死了。死法是**静默**的：没有字节，没有错误，没有结束。pi 还停在 `drive` 里等这个流，于是：

1. run 一直开着，`runHarnessTurn` 的 `finally` 跑不到，`borrowed.release()` 不执行。soul 的 lane 是所有回合串行排队的地方（`src/legion/execute/held.ts`：第二个 `acquire` 等第一个 `release`），所以全 app 的 soul 回合都排在这具尸体后面。
2. `readingTurns` 里这个线程的条目一直在，`liveTurns.has(threadId)` 为真。`use-call.ts` 的 `send` 看到有回合在飞，就把用户的话当成 steering 塞进死 run 的队列（docs/72），不开新回合。队列没人 drain，那句话谁也没看见。

`src/legion/execute/watchdog.ts` 的 60 秒停摆看门狗只包无人值守的管线（备课、笔记），对话回合从来没有过这层保护。

## 解法

`src/legion/execute/stall.ts`：一个只读挂钟的沉默计时器，注册在进程级的 registry 上。

- 判据读 `Date.now()` 的差值，不靠「定时器到点」。冻住的 webview 定时器不跑，解冻后怎么补跑是平台的事；挂钟无论如何已经跳过去了，解冻后落下的第一个 tick 就能判出来。
- 工具跑着的时候暂停（`hold` / `unhold`）。子 agent 和取页动辄几分钟不出声，要量的是供应商的沉默，不是回合的长度。
- 窗口 90 秒：比无人值守那档的 60 秒长，因为误杀一个读者在等的回合代价是整轮重来。
- 回前台那条边（`src/App.tsx` 里 `watchAppAwayForStalls(window)`）：离开超过 20 秒、且整个离开期间这条流一个字节都没来，回来立刻掐，不等满 90 秒。短暂切出去不算——切一下 app 不会弄死一条流。

掐的方式只能是 `lane.requestAbort(operationId)`，也就是用户按停止走的那条路。不能只 abort 底下那个 HTTP 请求：pi 的 `publishResponse` 见到 `stopReason: "aborted"` 而 durable control 不是 `cancel_requested`，会抛 `SessionInvariantError`。也不能让流自己 throw：`performGeneration` 没有兜它，异常会穿过 `drive` 出去。`requestAbort` 之后 run 正常结算、lane 交还、线程不再算 busy。

停止和停摆走的是同一条路，所以要一个标记把两者分开：`runHarnessTurn` 里 `stalled` 为真时，结算成 aborted 的分支报 `onError(STALL_MESSAGE, undefined, new StallError())`。`src/reading/session/use-call.ts` 认出 `isStall(thrown)` 就丢掉半截那一行，把没递进去的 steering 写回线程文件，然后原样再问一次（只一次）。问题本来就在线程文件里，重问读得到；用户看到的是一条来晚了的完整回复。

不 resume 而是重问：pi 确实能让一条 run 挂在 `assistant.retry_wait` 上等重试，但只对它自己的分类器认为可重试的失败，而那个分类器读的是供应商的措辞（见 `watchdog.ts` 里那段），停摆到它手上是一个没有任何裁决的 abort。重问多花一轮工具的 token，换一条完整的回复。

测试：`tests/legion/execute/stall.test.ts`（虚拟时钟）、`tests/legion/execute/turn-stall.test.ts`（掐完 lane 确实能再 acquire）。

关联坑：308（open operation 卡住 lane）、391（重启那条路上正文丢一半）。
