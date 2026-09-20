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

两条路，按「这条 run 的答案还有没有人收」分。

收不到的：`lane.abort()`。`requestAbort` 之后 drive 走 recovery 分支，同样写出那条合成的中断 toolResult，然后以 `aborted` 结算，不发请求。之后 lane 空闲，新回合照常 accept。`legion/execute/harness.ts` 的 `settlePrevious` 就是这么做的，没人接手时由 `rotateSession` 调它。

收得到的：`lane.resume()`，但先把收件方找回来。soul 的每个回合在 accept 之前往 lane 上写一条 custom entry `reading-partner.delivery`（装的是 BoxOrigin，没有 projector 所以进不了模型上下文），恢复时从那条分支的 tip 往回扫第一条就是本回合的，按它调那个地方注册的 delivery opener 重建系统提示、工具和预算裁剪，再 resume 把这条 run 跑完，说出来的话写进当初提问的那段对话（`src/soul/recover.ts`）。三种情况仍然 abort：没有这条 entry、那个地方没人注册 opener、同一条 run 已经写过两条 `reading-partner.recovery-attempt`（每次 resume 之前写一条，连 lane inbox 里还没落盘的也算，否则每次都死在模型调用之前就会无限重试）。

恢复跑在旧 session 自己的 harness 上，不占本进程那条常驻 lane：本进程的第一个回合不等它。两个 harness 不能共用 held.ts 的那个「当前回合」槽位——共用的话恢复会拿到读者此刻在问的那一回合的系统提示——所以 `holdHarness` 给恢复另开一个槽位和一份 models 注册表。

工具默认不重跑；只读、跑两遍只花一次读的工具声明 `replay: "safe"` 才重跑，而且要求死掉的那个进程写下的 intent 里也是 `safe`（`replay` 是按调用时的声明存进 session 的）。

resume 那一步用的是**死掉那个进程捕获的**模型和 active tool 名单（`generationContext.configuration`）：模型在这个进程的 models 里找不到、或者哪个工具名没注册，pi 直接以 `model_unavailable` / `configured_tools_unavailable` 结算，不发请求——所以改了默认模型之后那条 run 只会干净地失败，不会拿错模型去问。
