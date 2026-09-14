# legion

> 2026-09-07 定案。同步引擎与删除模型在 [13](./13-账户同步.md) 和 [50](./50-删除.md)，记忆的两个仓在 [48](./48-记忆：观察与statement.md)。回收（gc）归 memory，不在本文。info 管线重做在 [60](./60-info：白宫与Red Boxes.md)；[17](./17-信息源系统.md) 的源配置、站点登录、正文抽取仍有效，只废「提名→主题」层。2026-09-14 改：架构定为 orchestrator-worker，soul 是唯一的 orchestrator，legion 是 worker 底座；认领由租约改为按能力指派；session 不同步；第一个调用方改为 translate。

---

## 定位

架构是 orchestrator-worker，三个角色。

soul 是唯一的 orchestrator：一个用户一个，带记忆，和用户说话。一个回合里它只做听、判断、派，不干活（[67](./67-soul.md)）。

worker 是 run：一个 agent，或一段纯程序。它可以再派子 run，这时它自己是那些子 run 的 delegator。

legion 是 worker 底座，不认识业务也不认识编排：run 的身份和状态、放在哪台设备跑、执行的预算和看门狗、把结果送回 orchestrator，仅此。领域知识全在领域侧，legion 只认 `kind`——memory 把自己的蒸馏 pass 登记成一个 kind，legion 照跑，不知道跑的是什么。

这样切是为了把 soul 从干活里解放出来，压住语音对话的延迟。

agent 之间不说话，只通过 palace 里的文件协作。run 内部可以派子 agent，orchestrator-worker 是 run 内部的执行模式；run 之间不传话。post 到黑板自由，integrate 单写者，进书架过确认。

`@` 提及解析不做。

## 六项地基

1. run 是一等对象：一个 run 一份状态；跨设备那档的状态在盘上，不在进程内存里。
2. 脱手 + 回帖：delegate 写下就返回，回合不等；结果回来另起一个回合。
3. 并行 / join，带取消和去重：去重靠 `idempotencyKey`，join 靠 `batchId`。
4. 每资源写序：同一份资源同一时刻只有一个写者。并行的 run 把产出 post 到黑板，evaluate 之后由单个写者 integrate，执行侧就是 schedule 的每资源串行。
5. 统一可观测：每个 run 登记自己的输入和委托方，热层加 ledger 合起来是一张因果图——谁触发了谁，哪份产出喂进了哪次运行。
6. 调度：schedule 的产物是叫醒 soul 的一个回合，不是直接起 run。

另有两件横穿的：死信队列，和一律按引用传参——任务书和产出都是路径或 id，run 文件里不存内容。

## run

一次被委托出去、在用户视线之外发生、最后要回来交差的工作。

任务书发出即冻结，要改就是新 run。无产出的 run 是失败，不是空成功。

三件它不是的事：

- 不是 subagent。subagent 是执行手段之一，一个 run 里可以有零个或多个，也可以整个不用模型。
- 不是管线的一段。管线是领域知识。
- 不是对话消息。卡片是投递结果，run 记录是审计凭据和因果图节点。

run 分两档，`kind` 声明自己是哪档，delegate 的接口一样：本地快车道在同一个进程里跑几秒钟（查一页书、搜一个词），状态只在内存，不落同步文件夹；跨设备那档落 `legion/runs`，下面各节说的都是它。

字段：

| 字段 | 含义 |
|---|---|
| `id` | 全局唯一，即文件名 |
| `idempotencyKey` | 创建时去重，同一个 key 只有一个 run |
| `kind` | 领域登记的类型，legion 只认这个 |
| `tier` | `local` 或 `synced`，由 `kind` 定 |
| `delegator` | soul（用户开口或被叫醒的回合）/ 父 run 的 id |
| `brief` | 任务书，按引用 |
| `state` | `pending` < `running` < `cancelled` < `failed` < `done` |
| `claimant` | 执行设备 deviceId + 开始时刻 |
| `attempts` | 尝试次数 |
| `lastProgressAt` | 执行器每有实质进展推进一次 |
| `output` | 产出引用 |
| `deliverTo` | 投递目标 |
| 时间戳 | 创建、开始、终态、投递 |
| `revision` | 两个同级终态相撞时的裁决位 |
| `batchId` | 可选，join 按 batch 等 |

产出放领域自己的目录，run 只存引用：文件小，合并简单。

状态格是一条链，两台设备写同一个 run 时取格上更高的那个，对任意设备数都收敛。`revision` 只在两个同级终态相撞（弃权后被接手、原设备又回来跑完了）时用，同值按 deviceId 破平。

有 `idempotencyKey` 时文件名取 `hash(kind + key)`：两台设备写同一个路径，同步的合并直接把它们收敛成一份，不需要额外的去重协议。没有 key 就用随机 id。重放用新 key（`replay:<原 runId>:<n>`），否则和原 run 撞名。

批次先写一份清单 `legion/batches/<batchId>.json`（成员 id、创建时刻、期望成员数）再写各成员，join 以清单为准；清单写完而成员缺、过了宽限期，整批判 failed。第一版留字段不实现。

## delegate 与收件箱

delegate 是 soul 的一个工具：写一个 `pending` run 就返回句柄，回合不等。

soul 有收件箱和被叫醒的回合。结果到了就追加进 soul 的 session，起一个没有用户输入的回合，soul 决定说不说、什么时候说。

soul 随时能读 run 文件的进度字段回答「跑到哪了」，不必等它跑完。

回来的是有上限的 brief 加引用，产出进 palace。

## 指派、接手与取消

重活只在 PC 跑，移动端只划线、聊天和派活。run 的执行方由 `kind` 决定：presence 里广告能跑这个 kind 的设备。一个 kind 通常只有一台设备能跑，没有竞争认领，也就没有租约——租约是在没有原子取走的介质上模拟取走，执行方唯一时它没有东西可模拟。

同一 kind 有两台设备都能跑时，沿用 presence 的选举（连续在线最久者，`claimedAt` 相同按 deviceId 破平，24 小时没心跳算弃权），按 kind 算，设备级不是 run 级。输的那台站着不动。

接手三条：执行设备自己重启后，名下 `running` 的 run 退回 `pending`、`attempts` 加一，本机自己判断，不依赖别人的时钟；执行设备弃权后，同 kind 新当选的设备把它名下 `running` 的 run 退回 `pending` 接手；本机名下 `running` 但 `lastProgressAt` 超过阈值的，本机自己退回 `pending`、`attempts` 加一。正确性兜底是重跑无害：一个 run 跑两遍、两份结果合并后与跑一遍相同。

移动端派活就是写一个 `pending` run，PC 下次 pull 捡起来跑；移动端要看的只有 PC 上次在线时刻，来自 presence 心跳。

取消写进 run 文件，不是喊一声。执行设备下次 pull 读到就调执行器的 `cancel()`；本机委托、本机执行的 run 直接调 `cancel()`，不经过文件；没有执行者的 `pending` run 直接进 `cancelled`。

`attempts` 到上限的 run 停在 `failed`，不再自动重试。重放沿用同一份任务书，是一个指回原 run 的新 run。

前提不成立时 run 自己进 `failed`，在产出里写明哪条前提不成立；委托方决定是否用新任务书重开。不开澄清通道。

## 粒度与折叠

一件任务一个 run——取一篇文章的正文就是一个 run，subagent 在 run 里面。不怕文件多，文件数靠折叠控，不靠把任务合粗。

热层 `legion/runs/<runId>.json`，一个 run 一个文件。冷层 `legion/ledger/<日期>.jsonl`，一天一个追加文件，一个折叠过的 run 一行。ledger 行存任务书的引用加内容哈希，不存正文；重放前校验哈希，取不到就拒绝重放并说明原因。

三条同时成立才折：终态、已投递（mailbox ack 到了）、过了宽限期（约 24 小时，failed 更长）。

死信就是 ledger 里的 failed 行，不另开目录，UI 从 ledger 读。

ledger 兼做墓碑。同步不传播文件级删除（坑 208），所以热层删掉的 run 会被另一台设备推回来；判据是「热层有这个 id、ledger 里也有，且热层这份的创建时刻不晚于 ledger 行的」——时刻这一半防的是 key 回收后的同名新 run 被当成旧 run 删掉。两边各自据此删掉自己的热层文件，删远端走 `requestRemotePurge`。ledger 行按 id 取并集合并，任何设备都能折，规则是纯函数，两台设备折出同一行。

`legion/runs` 进 `NEVER_INFER_DELETE`：删除只认 ledger 墓碑，不认按持有清单的删除推断，否则一台折了一台没折时，推断会把对端的未折读成一次撤销。

代价在同步请求数：app 走 Drive API 一文件一请求，要压的是热层的文件数，不是磁盘字节。

## mailbox

`legion/mailbox`，四个动作 post / read / told / ack。它只做给人的投递，run 之间不用它。

投递目标是一台设备上的 soul。跨设备的 run 完成时，brief 追加进执行设备的 soul session 起一个回合，soul 说出来的话经对话文件同步到另一台。iPad 想知道 PC 跑到哪，读 run 文件的进度字段——执行器每有进展写回，随同步到达，最多晚一个 pull 间隔——不等 mailbox。

先把完整消息存下来，目标端持久记下之后才确认投递；queued 减 delivered 就是待恢复集合。run 的折叠判据依赖 ack，所以这条顺序不能倒。

词表只有 queued / delivered / acked。cable 的处置状态归 info（[63](./63-情报局：研究室、专项组与态势.md)），和投递语义不是一回事。

## presence

`legion/presence`，每设备一个心跳文件，广告自己的能力。选举算法从 `info/program/presence.ts` 和 `info/briefer/handoff.ts` 泛化。

今天那套是这样跑的：每台设备只写以自己命名的那个文件，一写者无合并，两台同时写产生两个文件而不是一次冲突。选举是「所有 claim 文件 + 时钟」的纯函数，每台设备各自算出同一个答案，输的那台站着不动。`claimedAt` 每次进程启动重置，所以赢的是连续在线最久的那台；`claimedAt` 相同按 deviceId 破平。心跳一小时一次，超过 24 小时没动静算弃权，下一台顶上；`claimedAt` 为 null 表示这台不参选（用户关了后台采集），立刻退出选举而不等弃权阈值。开着同步的设备在本次会话第一次 pull 落地之前不写 claim——对一个还没读过的文件夹宣称所有权，正是两台机器同时认为自己是采集端的成因；等不到就在 30 分钟后不再等。重启的设备排到队尾，不把活从接手的那台手里抢回来。

泛化之后 claim 不再只说「我是采集端」，而是说这台设备能跑哪些 kind（有没有 webview fetch、有没有 GPU、是不是常开）；哪台设备跑哪个 kind 的 run 就是这份心跳的下游。

## schedule

`legion/schedule`，提供时点窗口、FIFO 和每资源串行。

schedule 的产物是叫醒 soul 的一个回合，不是直接起 run；派什么由 soul 决定。挂在夜间时点上的 run 按 `kind` 走 presence 选举，只有当选的那台创建，两台都到点也只跑一遍。

夜间那个时点是共用的：memory 的 dream 挂在上面，各领域自己的 housekeeping（info 日切缓存、退役设备的残留文件、run 折 ledger）也挂在上面。schedule 只提供时点和串行，不知道挂上来的是什么。

夜班的编排是情报局登记的一个纯程序 worker，就是 [63](./63-情报局：研究室、专项组与态势.md) 的采集经理：读源注册表和态势，扇出 collect → analyze → synthesize 子 run，写 tasking 队列，装盒，零模型调用。soul 夜里被叫醒只做一件事：派它，可带参数（哪个研究室多给预算、哪个跳过）。判断在子 run 里，编排在程序里，每晚同一套流程，反馈按产物版本归因才成立。

## execute

`legion/execute`，领域执行器的签名是 `run() → { cancel, done, readOutput? }`。

已经在的：

- `agent-turn.ts` 的 `startAgentTurn(request) → { result, steer, followUp }`，一次 agent 运行，轮次上限、预算裁剪、工具计数、看门狗都留在外面。
- `watchdog.ts`：流式调用静默超时就 abort 重试，provider 说是确定性失败的不重试，用户 Stop 抛 `StoppedError`。
- `observable-run.ts`：长管线共用的 subscribe/snapshot 外壳和活跃度计数。
- `limiter.ts`：整组的并发与起跑间隔，429 是让整组慢下来，不是这一次调用倒霉。
- `subagent/`：隔离上下文的子 agent 运行器。

进程内那半搬到 pi-agent-core 0.85.1 的 `AgentHarness`：soul 一条 lane，本地快车道的 worker 各一条（`lane(name, { createAt: tip })` 继承上下文，可换模型和工具集）；收件箱是 `appendCustomEntry` 加 `nextRun`；跨进程重启靠 `create` 返回的 open 列表和 `resume()`，默认不重跑工具，写一条合成 toolResult 说中断了，要重执行的工具自己声明 `replay: "safe"`；worker lane 的分支摘要不会自己回来，由 app 调 `generateBranchSummary` 再写进 soul 的 lane。跨设备那半仍是 run 文件。两边的接缝只有一处：run 完成后由谁把 brief 追加进 soul 的 lane。

落位：`legion/execute/harness.ts` 是工厂，建 `AgentHarness` 和 `JsonlSessionRepo`；`legion/execute/turn.ts` 用它提供今天 `runAgentTurn` 的同一份契约。`src/ai/agent.ts` 里手写的 `runAgentLoop` / `runAgentTurn` 退役，调用方改从 `legion/execute` import，`src/ai` 只剩 provider、鉴权、streamFn、消息转换这类接线。`legion/subagent` 退成 lane 上的薄壳：fork 出一条 worker lane，分支摘要就是 brief。`legion/execute/agent-turn.ts` 零调用方，删除。

两个未定点跟着第一个真调用方定：看门狗重试从原始消息重建 Agent，但轮次跨重试累加；`transformContext` 的截断不写回 Agent 的消息记录，每轮重算。

## session

session 是 agent 派活过程的运行时数据，对用户不重要，不同步。palace 登记一行 `session`，sync 为 `local`，目录 `session/`。

对话文件是数据，照旧按归属存、照旧同步（[67](./67-soul.md)）。两者之间是单向投影：soul 说的每一句落地时写进归属文件；反向不投影——另一台设备写的对话到了本机，soul 下回合装配上下文时从数据层读，走 sequence。

压缩摘要不跨设备，值得留的写成 observation 进 memory。本地 worker 的过程不进对话文件，对话里只有 soul 对用户说的话。

两台设备各跑一个 soul 进程，共享 memory 和对话即同一个人，各自一份「此刻在想什么」。PC 不在线时 iPad 照样有 soul。

session 仓用 pi 的 `JsonlSessionRepo`，文件系统是注入的：`platform/app/session-fs.ts` 在 appData 上实现那 12 个方法就够，`StorageBackedSession` 和 `SessionRepo` 不用自己写。

## 目录与依赖

```
legion/
  run/        run 文件的读写、状态格、指派、折叠
  mailbox/    post / read / told / ack
  presence/   每设备心跳与选举
  schedule/   时点窗口、FIFO、每资源串行
  execute/    执行器契约、harness 工厂与 turn、watchdog、observable-run、limiter
  subagent/   harness lane 上的薄壳
```

session 不在 legion 目录里：FileSystem 适配是 `platform/app/session-fs.ts`，`session` 那一行登记在 palace，harness 的装配在 `legion/execute`。soul 只装配回合（prompt、工具、角色），后一步持有自己的 lane。

legion → ai、budget、platform；ai 不 import legion。info、reading、memory、soul → legion。legion 永不 import memory——memory 把蒸馏 pass 登记成 run kind，方向只有这一个。

legion 在 `tests/layering.test.ts` 的 LAYER 表里登记为 capability，上面每个新子目录都要各自登记一行。

第一个跨设备调用方是 translate（翻整本书）：iPad 上 soul 派一个 `pending` run，PC 按能力当选执行，产出回领域目录，brief 经 mailbox 回 PC 的 soul。info 的 kind 清单在 [63](./63-情报局：研究室、专项组与态势.md) 已列好，等 Red Boxes 落地时登记。

## 现状与顺序

0.14.6 已落地的全是搬家和地基：`ai/subagent` → `legion/subagent`，watchdog / observable-run / limiter → `legion/execute`（纯移动，十处调用方改指，行为零变化）；pi-ai 与 pi-agent-core 升到 0.85.1；`startAgentTurn` 有测试、无调用方；LAYER 表补了 legion 三行。

未开始：session 与 harness、run、mailbox、presence、schedule、执行器契约、ledger 折叠。

1. 底座：`platform/app/session-fs.ts`、palace 的 `session` 登记行、`legion/execute/harness.ts` 的 harness 工厂。验收：杀掉进程再起，`resume()` 接上，未完成的工具写成合成 toolResult。
2. turn 换成 harness 背后的那一份：`legion/execute/turn.ts` 顶掉 `src/ai/agent.ts` 的手写循环，调用方改 import，`legion/subagent` 退成 lane 上的薄壳。验收：行为不变，`tests/ai/agent.test.ts` 那 24 条行为测试搬过去仍绿。
3. run 类型与合并：`mergeRun` 纯函数，`palace/merge-types.ts` 加 `lattice` 并在 `platform/sync/merge/` 实现，`legion/runs` 登记进 palace 和 `NEVER_INFER_DELETE`。验收：可交换、可结合、幂等各一组用例；终态两两组合；同 `revision` 按 deviceId 破平。
4. run store：创建（有 key 走派生文件名）、读、列、状态迁移、取消。验收：内存文件系统下模拟两台设备，同 key 两次创建只得一个文件；撞 `running` 返回同一 runId，撞 `done` 返回原产出引用。
5. presence 泛化：claim 带 `capabilities`，`electFor(kind, claims, now)`，info 的采集端改成调它。验收：现有 handoff 测试搬过来仍绿；两台都能跑取连续在线最久，都不能跑返回 null。
6. 指派与 schedule：`dueRuns(runs, claims, now, deviceId)`，时点窗口，夜间时点按 kind 归一台。验收：这个函数的单测不许起执行器；本机重启退回、对端弃权接手、`lastProgressAt` 超阈值退回各一例。
7. execute 契约与运行器：kind → 执行器的注册表，取走 → 写 `running` → 跑 → 写终态 → 推 `lastProgressAt`。验收：假执行器走完全程；取消写进文件后 `cancel()` 被调；到 `attempts` 上限停在 `failed` 不再重试。
8. mailbox：post / read / told / ack。验收：投递后 ack 到达；未 ack 的出现在待恢复集合里；重复 post 同一条不产生两份。
9. ledger 折叠：`foldRun` 纯函数、三条判据、墓碑含时刻比较。验收：两台折出逐字节相同的一行；创建时刻更晚的同名新 run 不被误删；未 ack 的终态 run 不折。
10. translate 接入：kind `translate-book` 注册，`TranslateRun` 单例的工作体抽成执行器并补 cancel 通道，状态 UI 改成订阅 run 文件。验收：无头双设备测试跑完 A 写 pending、B 当选执行、产出与 ack 回到 A 的整条链；取消在跑到一半时生效；真机确认一次，iPad 派、PC 跑。

## 为什么不用现成的

DeepSeek Harness 的 jobs / workflow / schedule / agent-team 全部以「一机一进程一份 session 日志」为前提，Node 运行时，iPad 的 WKWebView 里跑不了；市面的任务队列（BullMQ、Temporal、pg-boss、Inngest）都要数据库或服务端。我们的 run 跨两台设备、靠一个同步文件夹、没有服务端。所以 run 的文件格式和指派规则自己写，只借三处设计：jobs 的 `run() → { cancel, done, readOutput? }` 作执行器签名，agent-team 任务快照的 `revision` 作同级终态相撞时的裁决位，mailbox 的「先存完整消息、投递到才确认、queued 减 delivered 即待恢复」作投递语义。

pi harness 借的是持久 session、lane、resume 和分支摘要；没借的是跨设备——它以一台设备一个进程为前提，run 的文件格式、指派与合并仍是自己的。
