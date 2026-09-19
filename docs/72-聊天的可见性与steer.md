# 聊天的可见性与 steer

> 2026-09-18 定案。上游：[55](./55-legion.md) 是 run 与 progress，[68](./68-Lumen与盒子的交互.md) 是回原地与盒，[71](./71-soul.md) 是 soul，[03](./03-陪读交互-通话模型.md) 是 turn 属于线程，[21](./21-info收藏与reading打通.md) 是可见性是闸的一部分。
>
> 取代关系：本文修订 68「阅读聊天里不再显示子 agent 的进度行」一句、55 第 11 步（translate 接入）的状态、03「掐断只有两种」一节的掐断清单。

---

## 诊断

聊天里只有三个点：thinking 事件到了适配层就没接线，读者看不出 soul 是在想还是在查。

写入类动作一条而过：工具成功即从状态行删除、从不落盘，回答关掉之后什么都没留下。

工具契约没有面向读者的通道：`AgentTool` 只有 `name`、`description`、`parameters`、`execute`，`ToolResult` 只有 `text`、`images`。于是三张人话表各自生长——reading 一张、info/briefer 一张、info/sources 一张——互相不认识，合起来只覆盖 44 个工具里的 17 个，其余显示裸工具名。

## 线程是时间线

线程文件按发生顺序落五种东西：读者说的话、soul 说的话、回执单（soul 做了一件写入：记了什么）、派工单（派出去了什么，跑到哪，回来后指向那条回复）、送达（run 回来 soul 说的话，带一个标说明答的是哪一问）。

`PersistedPart` 从 text / card 扩到 text / card / trace：落盘的只有 trace，回执单和派工单由它派生（`messageToParts`），一次发生只有一条记录。rehydrate 按文件顺序画，不从别处重建——盒（68）和 run 文件仍是各自的真相源。

## 工具契约

`AgentTool` 加 `label(args)`：读者看的、运行中那一句，取代三张各自维护的人话表。`effect: read | write` 分流。`gate?: card | trial | instruction` 是 write 类工具声明自己过的闸，同 `soul/roles.ts` 今天的三种。

`ToolResult` 加 `receipt`：`label`、`summary`、`link`。label 透传 SDK 的 label 槽，receipt 走 details 槽——这两个槽位今天都被适配层填空。

write 类工具执行完没带 `receipt` 回来，适配层抛错。闸从此在运行时成立，21 说的「可见性是闸的一部分」有了实现。

三张人话表删除。

## 读者看到的

soul 在跑时那一行有一个阶段：Thinking… / 工具的 `label` / 出字。不出思考原文。

回答落地后，成功的工具收成一行灰字落盘；失败的留红字和原因。

回执单是一种通用的 part：label、一句摘要、可选跳转，不按工具分。

派工单也是一种 part，读 run 文件的 `progress`（55 的三十秒节流）；跑完翻成「回来了」指向送达的那条，失败翻成「要你定」。

## steer

读者在 soul 跑着的时候说话，不打断，走 pi-agent-core 的 steer 队列。

注入点是每一轮（一次模型输出加它那轮的工具）结束后，最多等一轮。读者那句立刻作为自己的一行落在正在写的 AI 行下面，带淡标记；这一轮完了模型看见它，接下去的回复是新的一行。连发几句同一点注入。

停止键仍是真掐断，保留半句；队列里没注入的话作为下一回合的开头发出。

Composer 在流式期间 Send 和 Stop 都在。

答铃回合登记进 `liveTurns`：铃到时那条线程正有一轮在跑，回复 steer 进去而不另起一轮。

## soul 知道自己派了什么

装配桌子时带上这条线程派出去还在跑的 run，一行一个：kind、brief 第一句、跑了多久、`progress` 那句。

## 不做的

在跑的 run 的全局入口：阅读不存在持续派活干很久的事，不需要一个跨线程看所有 run 的地方。

思考原文。

三套流式状态机的归一：reading 的 `call-state`、chat 的 streaming-turn、info 的 `useState`，各自接线，这次不做统一。

## 落地状态

2026-09-18 已进 main：

- `platform/app/threads.ts` 的 `onThreadMessage` 订阅，消掉 68「正看着就不放盒」前提不成立的盲区。
- 翻译改 kind `translate-book`（55 第 11 步）。
- `ingest_url` 改 kind `ingest-url`，写 run 就返回。
- `WorkerRegistration.delegable` 正向标记：soul 的 delegate 目录只列声明了的，`collect` 因此不再出现在目录里。
- `Runner.subscribe`。
- 回执单与派工单：trace 里带 receipt 的 done 项派生成 part，`link.kind === "run"` 的派生成派工单，派工单读 run 文件（`dispatch-view.ts`）。
- soul 装配时带上这条线程还在跑的 run（`self.ts` 的 `openRuns`）。
- 工具契约：`label(args)` / `effect` / `gate` / `receipt`，write 类无 receipt 适配层抛错，`tests/soul/tool-contract.test.ts` 的 ROSTER 管完整性，三张人话表删除。
- 思考态一行：`TurnPhase`，`PhaseLine` 替掉三个点，三个界面都接 `onThinking`。
- steer：`onSteerable` 端口，`reading/steering.ts`，Composer 流式期间 Send 与 Stop 并存，停止时未注入的话开下一回合。
- 答铃 steer 进在跑的轮（`reading/delivered.ts`），答铃自起的回合按 silent 登记进 liveTurns，送达行落 `origin: { runId }`。

以上随 v0.20.2 发出。

## 尾巴

答铃回合改成拿正文：soul 读 brief 和 output 两个文件喂给回合，读不到才说不在这台设备上；盒子项的 body 也存产出正文而不是路径。未发版。

steer 只在书的对话里；retell、rehearsal、简报对话仍是另起回合。图片不能随 steer，留到下一次普通发送。答铃自起的回合不流式，回复一次到达；silent 回合结束时未交出的话写进文件但不自动续跑。

Outline 刷新靠 `local` 档 run 的 `done`，`synced` 档没有。

`openThread` 读文件到 callRef 更新之间到达的追加会少显示一条。

延迟另议：本机实测一轮模型调用地板约 5 秒，低档思考第一轮 600-1300 字，生成每秒 35-40 token。
