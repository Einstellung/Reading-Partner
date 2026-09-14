# legion

> 2026-09-07 定案。同步引擎与删除模型在 [13](./13-账户同步.md) 和 [50](./50-删除.md)，记忆的两个仓在 [48](./48-记忆：观察与statement.md)。回收（gc）归 memory，不在本文。info 管线重做在 [60](./60-info：白宫与Red Boxes.md)；[17](./17-信息源系统.md) 的源配置、站点登录、正文抽取仍有效，只废「提名→主题」层。2026-09-14 改：架构定为 orchestrator-worker，soul 是唯一的 orchestrator，legion 是 worker 底座；认领由租约改为按能力指派；session 不同步；第一个调用方改为 translate。2026-09-14 再改：presence 改名 claim、mailbox 改名 bell（三种铃）、run 加 progress、batch 续跑、子 run 深度限两层。

---

## 定位

架构是 orchestrator-worker，三个角色。

soul 是唯一的 orchestrator：一个用户一个，带记忆，和用户说话。一个回合里它只做听、判断、派，不干活（[67](./67-soul.md)）。

worker 执行一个 run：里面有模型的是 agent worker，没有的是程序 worker。

legion 是 worker 底座，不认识业务也不认识编排：run 的身份和状态、放在哪台设备跑、执行的预算和看门狗、把结果送回 orchestrator，仅此。领域知识全在领域侧，legion 只认 `kind`——memory 把自己的蒸馏 pass 登记成一个 kind，legion 照跑，不知道跑的是什么。

这样切是为了把 soul 从干活里解放出来，压住语音对话的延迟。

agent 之间不说话，只通过 palace 里的文件协作：post 到黑板自由，integrate 单写者，进书架过确认。

`@` 提及解析不做。

## 六项地基

1. run 是一等对象：一个 run 一份状态；跨设备那档的状态在盘上，不在进程内存里。
2. 脱手 + 回帖：delegate 写下就返回，回合不等；结果回来另起一个回合。
3. 并行 / join，带取消和续跑：程序 worker 派的子 run 带 `batchId` 和 `step`，重跑时已经 done 的步跳过。
4. 每资源写序：同一份资源同一时刻只有一个写者。并行的 run 把产出 post 到黑板，evaluate 之后由单个写者 integrate，执行侧就是 schedule 的每资源串行。
5. 统一可观测：每个 run 登记自己的输入和委托方，热层加 ledger 合起来是一张因果图——谁触发了谁，哪份产出喂进了哪次运行。
6. 调度：schedule 的产物是一条 wake 铃，不是直接起 run。

另有两件横穿的：死信队列，和一律按引用传参——任务书和产出都是路径或 id，run 文件里不存内容。

## worker

worker 是执行一个 run 的那段代码，领域登记 `kind` 时交的就是它，签名 `run(brief, ctx) → { cancel, done }`。

两种。agent worker 里有模型：runner 在 harness 上开一条 lane，给它任务书、模型和这个 kind 的最小工具集。程序 worker 没有模型调用，是普通代码——翻译管线、采集经理、蒸馏 pass。两种对 legion 长得一样。

worker 不是设备也不是进程。soul 不是 worker，它是唯一的派活方，自己不接 run。

worker 之间没有通道。分析员之间要共享东西走态势文件（[63](./63-情报局：研究室、专项组与态势.md)），不走信。run 之间不记依赖，先后顺序在程序 worker 的代码里。

子 run 只从 soul 和程序 worker 派。agent worker 里的模型没有 delegate 工具，它想分工只能在进程内开 lane（今天的 subagent），结果回到同一个 run，不产生新文件。子 run 不能再派孙 run：runner 看 `delegator` 是一个 run、且那个 run 的 `delegator` 也是 run 就拒绝。run 图最深两层——soul、采集经理、分析员。派几个由代码定，不由模型定。

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
| `idempotencyKey` | `batchId` + `step`，只有这一个用法 |
| `kind` | 领域登记的类型，legion 只认这个 |
| `tier` | `local` 或 `synced`，由 `kind` 定 |
| `delegator` | soul（用户开口或一条铃起的回合），或派它的那个程序 worker 的 run id |
| `brief` | 任务书，按引用 |
| `state` | `pending` < `running` < `cancelled` < `failed` < `done` |
| `claimant` | 执行设备 deviceId + 开始时刻 |
| `attempts` | 尝试次数 |
| `progress` | 一行字，只留最后一行 |
| `lastProgressAt` | worker 每有实质进展推进一次 |
| `output` | 产出引用 |
| `deliverTo` | 投递目标 |
| 时间戳 | 创建、开始、终态、投递 |
| `revision` | 两个同级终态相撞时的裁决位 |
| `batchId` | 可选，父 run 的 id |
| `step` | 可选，父程序自己起的稳定名，同 `batchId` 下唯一 |

产出放领域自己的目录，run 只存引用：文件小，合并简单。

状态格是一条链，两台设备写同一个 run 时取格上更高的那个，对任意设备数都收敛。`revision` 只在两个同级终态相撞（弃权后被接手、原设备又回来跑完了）时用，同值按 deviceId 破平。

有 `idempotencyKey` 时文件名取 `hash(kind + key)`：两台设备写同一个路径，同步的合并直接把它们收敛成一份，不需要额外的去重协议。没有 key 就用随机 id。通用的 `idempotencyKey` 不做，它只有 batch 续跑这一个用法。

`progress` 是一行字，给人看跑到哪了。runner 给 worker 的 ctx 里有 `report(text)`：程序 worker 每步自己调（「抓取 12/40」），agent worker 由 runner 在每次工具调用结束时自动填工具名和轮数。runner 收到 report 就更新 `progress` 和 `lastProgressAt`、`revision` 加一、写回 run 文件；同一个 run 最多每三十秒写一次盘，状态变化不受节流。完整流水在本机 session 里，不同步。卡住判定只看 `lastProgressAt` 超时，不看墙上时钟。

## batch 续跑

程序 worker 派的子 run 带 `batchId`（父 run 的 id）和 `step`（父程序自己起的稳定名，如 `analyst:<专项组 id>`）。

父程序派每一步之前先查同 `batchId` 同 `step` 的 run：有 `done` 的取它的 `output` 跳过；有 `pending` 或 `running` 的等它，不新建；有 `attempts` 用尽的 `failed` 按这一步失败处理。

去重靠文件名：key = `batchId` + `step`，文件名 `hash(kind + key)`，两台设备写同一路径由合并收敛。

`legion/batches` 清单不做——有哪些步是父程序自己知道的，不需要再写一份。

## delegate 与 bell

delegate 是 soul 的一个工具：写一个 `pending` run 就返回句柄，回合不等。

回来的路是 bell。一条 `run-done` 到了，soul 的代码把 brief 追加进它的 lane，起一个没有用户输入的回合，soul 决定说不说、什么时候说。

soul 随时能读 run 文件的 `progress` 回答「跑到哪了」，不必等它跑完。

## 指派、接手与取消

重活只在 PC 跑，移动端只划线、聊天和派活。run 的执行方由 `kind` 决定：claim 里声明能跑这个 kind 的设备。一个 kind 通常只有一台设备能跑，没有竞争认领，也就没有租约——租约是在没有原子取走的介质上模拟取走，执行方唯一时它没有东西可模拟。

同一 kind 有两台设备都能跑时，沿用 claim 的选举（连续在线最久者，`claimedAt` 相同按 deviceId 破平，24 小时没心跳算弃权），按 kind 算，设备级不是 run 级。输的那台站着不动。

接手三条：执行设备自己重启后，名下 `running` 的 run 退回 `pending`、`attempts` 加一，本机自己判断，不依赖别人的时钟；执行设备弃权后，同 kind 新当选的设备把它名下 `running` 的 run 退回 `pending` 接手；本机名下 `running` 但 `lastProgressAt` 超过阈值的，本机自己退回 `pending`、`attempts` 加一。正确性兜底是重跑无害：一个 run 跑两遍、两份结果合并后与跑一遍相同。

移动端派活就是写一个 `pending` run，PC 下次 pull 捡起来跑；移动端要看的只有 PC 上次在线时刻，来自 claim 心跳。

取消写进 run 文件，不是喊一声。执行设备下次 pull 读到就调 worker 的 `cancel()`；本机委托、本机执行的 run 直接调 `cancel()`，不经过文件；没有执行者的 `pending` run 直接进 `cancelled`。

取消只级联一层：取消一个父 run 时，runner 按 `batchId` 把它的子 run 一并取消。再往下没有，run 图只有两层。

`attempts` 到上限的 run 停在 `failed`，不再自动重试。重放沿用同一份任务书，是一个指回原 run 的新 run。

前提不成立时 run 自己进 `failed`，在产出里写明哪条前提不成立；委托方决定是否用新任务书重开。不开澄清通道。

## 粒度与折叠

一件任务一个 run——取一篇文章的正文就是一个 run，subagent 在 run 里面。不怕文件多，文件数靠折叠控，不靠把任务合粗。

热层 `legion/runs/<runId>.json`，一个 run 一个文件。冷层 `legion/ledger/<日期>.jsonl`，一天一个追加文件，一个折叠过的 run 一行。ledger 行存任务书的引用加内容哈希，不存正文；重放前校验哈希，取不到就拒绝重放并说明原因。

三条同时成立才折：终态、已投递（bell 的 ack 到了）、过了宽限期（约 24 小时，failed 更长）。

死信就是 ledger 里的 failed 行，不另开目录，UI 从 ledger 读。

ledger 兼做墓碑。同步不传播文件级删除（坑 208），所以热层删掉的 run 会被另一台设备推回来；判据是「热层有这个 id、ledger 里也有，且热层这份的创建时刻不晚于 ledger 行的」——时刻这一半防的是 key 回收后的同名新 run 被当成旧 run 删掉。两边各自据此删掉自己的热层文件，删远端走 `requestRemotePurge`。ledger 行按 id 取并集合并，任何设备都能折，规则是纯函数，两台设备折出同一行。

`legion/runs` 进 `NEVER_INFER_DELETE`：删除只认 ledger 墓碑，不认按持有清单的删除推断，否则一台折了一台没折时，推断会把对端的未折读成一次撤销。

代价在同步请求数：app 走 Drive API 一文件一请求，要压的是热层的文件数，不是磁盘字节。

## bell

`legion/bell`，三个动作 ring / read / ack。收件人始终是某台设备上的 soul，用户看不见。

一条铃有 `type`，闭集三种：

- `run-done`：runId、kind、有上限的 brief、output 引用。soul 的代码把 brief 追加进它的 lane，起一个没有用户输入的回合；brief 超长就截断，附一句完整产出在 output 引用里。
- `run-failed`：runId、kind、失败原因（哪条前提不成立、`attempts` 用尽）。soul 决定要不要说。
- `wake`：schedule 到点，带 schedule id 和它登记的任务书。夜里没有用户时 soul 被叫醒的唯一入口。

凡是不由用户开口而起的 soul 回合都从 bell 进来，soul 只有这一个收件口。取消和进度不起回合，都在 run 文件里，不是铃。

跨设备的 run 完成时，铃投给执行设备上的 soul，它说出来的话经对话文件同步到另一台。iPad 想知道 PC 跑到哪，读 run 文件的 `progress`——随同步到达，最多晚一个 pull 间隔——不等 bell。

先把完整消息存下来，目标端持久记下之后才确认投递；queued 减 delivered 就是待恢复集合。run 的折叠判据依赖 ack，所以这条顺序不能倒。

词表只有 queued / delivered / acked。cable 的处置状态归 info（[63](./63-情报局：研究室、专项组与态势.md)），和投递语义不是一回事。

bell 不是 Red Box。Red Box（[60](./60-info：白宫与Red Boxes.md)）是给用户的交付物，bell 是「活干完了」的通知。采集经理跑完，程序层把 cable 装进 Red Box，同时一条 `run-done` 进 bell。

## claim

`legion/claim`，每台设备一份 claim 文件，声明在线时刻和本机能跑的 kind。它是今天 info 那份 claim 文件（「我是采集端」）的泛化，选举算法从 `info/program/presence.ts` 和 `info/briefer/handoff.ts` 泛化。

今天那套是这样跑的：每台设备只写以自己命名的那个文件，一写者无合并，两台同时写产生两个文件而不是一次冲突。选举是「所有 claim 文件 + 时钟」的纯函数，每台设备各自算出同一个答案，输的那台站着不动。`claimedAt` 每次进程启动重置，所以赢的是连续在线最久的那台；`claimedAt` 相同按 deviceId 破平。心跳一小时一次，超过 24 小时没动静算弃权，下一台顶上；`claimedAt` 为 null 表示这台不参选（用户关了后台采集），立刻退出选举而不等弃权阈值。开着同步的设备在本次会话第一次 pull 落地之前不写 claim——对一个还没读过的文件夹宣称所有权，正是两台机器同时认为自己是采集端的成因；等不到就在 30 分钟后不再等。重启的设备排到队尾，不把活从接手的那台手里抢回来。

泛化之后 claim 不再只说「我是采集端」，而是说这台设备能跑哪些 kind（有没有 webview fetch、有没有 GPU、是不是常开）；哪台设备跑哪个 kind 的 run 就是这份声明的下游。

## schedule

`legion/schedule`，提供时点窗口、FIFO 和每资源串行。

schedule 的产物是一条 `wake` 铃，不是直接起 run；派什么由 soul 决定。挂在夜间时点上的 run 按 `kind` 走 claim 选举，只有当选的那台创建，两台都到点也只跑一遍。

夜间那个时点是共用的：memory 的 dream 挂在上面，各领域自己的 housekeeping（info 日切缓存、退役设备的残留文件、run 折 ledger）也挂在上面。schedule 只提供时点和串行，不知道挂上来的是什么。

夜班的编排是情报局登记的一个纯程序 worker，就是 [63](./63-情报局：研究室、专项组与态势.md) 的采集经理：读源注册表和态势，扇出 collect → analyze → synthesize 子 run，写 tasking 队列，装盒，零模型调用。soul 夜里被叫醒只做一件事：派它，可带参数（哪个研究室多给预算、哪个跳过）。判断在子 run 里，编排在程序里，每晚同一套流程，反馈按产物版本归因才成立。

## execute

`legion/execute`，worker 的签名是 `run(brief, ctx) → { cancel, done }`。

runner 是 `kind` → worker 的注册表加一圈外壳：取走 → 写 `running` → 跑 → 写终态 → 投一条铃。`ctx` 里有 `report(text)`，agent worker 的那份由 runner 在每次工具调用结束时自动调。runner 还管三件闸：`delegator` 深度超两层的创建请求拒绝，带 `batchId` + `step` 的创建先查已有的那一份，取消按 `batchId` 级联一层。

已经在的：

- `turn.ts` 的 `runAgentTurn`：一次工具循环回合，跑在 harness 的一条 lane 上，契约在 `contract.ts`；轮数上限走 `before_request`，预算裁剪走 `toProviderMessages` 每轮重算不写回，遥测挂 `message_end`。
- `watchdog.ts`：流式调用静默超时就 abort 重试，provider 说是确定性失败的不重试，用户 Stop 抛 `StoppedError`。
- `observable-run.ts`：长管线共用的 subscribe/snapshot 外壳和活跃度计数。
- `limiter.ts`：整组的并发与起跑间隔，429 是让整组慢下来，不是这一次调用倒霉。
- `subagent/`：隔离上下文的子 agent 运行器。

进程内那半搬到 pi-agent-core 0.85.1 的 `AgentHarness`：soul 一条 lane，本地快车道的 worker 各一条（`lane(name, { createAt: tip })` 继承上下文，可换模型和工具集）；一条铃进 soul 的 lane 是 `appendCustomEntry` 加 `nextRun`；跨进程重启靠 `create` 返回的 open 列表和 `resume()`，默认不重跑工具，写一条合成 toolResult 说中断了，要重执行的工具自己声明 `replay: "safe"`；worker lane 的分支摘要不会自己回来，由 app 调 `generateBranchSummary` 再写进 soul 的 lane。跨设备那半仍是 run 文件。两边的接缝只有一处：run 完成后由谁把 brief 追加进 soul 的 lane。

落位：`legion/execute/harness.ts` 是工厂，建 `AgentHarness` 和 `JsonlSessionRepo`；`legion/execute/turn.ts` 用它提供今天 `runAgentTurn` 的同一份契约。`src/ai/agent.ts` 里手写的 `runAgentLoop` / `runAgentTurn` 退役，调用方改从 `legion/execute` import，`src/ai` 只剩 provider、鉴权、streamFn、消息转换这类接线。`legion/subagent` 是 lane 上的薄壳：子 agent 起自己的 harness 和 session，lane 名 `worker:<定义名>`、session 组 `worker`，工具集是调用方给的最小集；不挂在调用方的 harness 上，因为 pi 的 lane 只能换模型、思考档和工具名，系统提示和工具注册表是 harness 级的（坑 307）。brief 仍由 `subagent/brief.ts` 出，pi 的分支摘要是压缩摘要，说不出「没证据」「轮数用尽」这些区别。手写循环 `agent-turn.ts` 已删。

soul 的那条 lane 已经常驻：`legion/execute/held.ts` 把一个 harness 跨回合持有（session 组 `soul`、lane 名 `soul`，`src/soul/harness.ts` 进程内懒建一份），`runAgentTurn` 的 `harness` 参数让 soul 的五个回合面（阅读聊天、info 聊天与语音、排练教练、复述）跑在它上面，subagent 和后台 pass 仍各自开 harness。每回合先把 lane 导航回 session 根再 accept，模型收到的只有本回合装配的消息加自己的工具轮次，session 文件按回合各存一条根分支、不回灌上下文（[67](./67-soul.md)）。工具、系统提示和模型注册表是 harness 级的（坑 307），所以 harness 建一次，按回合换入。重启后重开该组最新 session，上个进程留下的 open operation 逐条 abort 而不是 resume（坑 308）。

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
  bell/       ring / read / ack，三种铃
  claim/      每设备声明与选举
  schedule/   时点窗口、FIFO、每资源串行
  execute/    worker 契约与 runner、harness 工厂与 turn、watchdog、observable-run、limiter
  subagent/   harness lane 上的薄壳
```

session 不在 legion 目录里：FileSystem 适配是 `platform/app/session-fs.ts`，`session` 那一行登记在 palace，harness 的装配在 `legion/execute`。soul 只装配回合（prompt、工具、角色），后一步持有自己的 lane。

legion → ai、budget、platform；ai 不 import legion。info、reading、memory、soul → legion。legion 永不 import memory——memory 把蒸馏 pass 登记成 run kind，方向只有这一个。

legion 在 `tests/layering.test.ts` 的 LAYER 表里登记为 capability，上面每个新子目录都要各自登记一行。

第一个跨设备调用方是 translate（翻整本书）：iPad 上 soul 派一个 `pending` run，PC 按能力当选执行，产出回领域目录，brief 经 bell 回 PC 的 soul。info 的 kind 清单在 [63](./63-情报局：研究室、专项组与态势.md) 已列好，等 Red Boxes 落地时登记。

## 现状与顺序

已落地（2026-09-14）：第 1、2 步。session-fs 与 palace 的 `session` 行、harness 工厂、`legion/execute/turn.ts` 顶掉手写循环、`legion/subagent` 成为 worker lane 薄壳、旧循环全部删除；pi-ai 与 pi-agent-core 0.85.1；LAYER 表有 legion 三行。

未开始：run、bell、claim、schedule、worker 契约与 runner、ledger 折叠、soul 持有 lane 与 session 到对话文件的投影。

1. 底座：`platform/app/session-fs.ts`、palace 的 `session` 登记行、`legion/execute/harness.ts` 的 harness 工厂。验收：杀掉进程再起，`resume()` 接上，未完成的工具写成合成 toolResult。
2. turn 换成 harness 背后的那一份：`legion/execute/turn.ts` 顶掉 `src/ai/agent.ts` 的手写循环，调用方改 import，`legion/subagent` 退成 lane 上的薄壳。验收：行为不变，`tests/ai/agent.test.ts` 那 24 条行为测试搬过去仍绿。
3. run 类型与合并：字段含 `progress`、`batchId`、`step`，`mergeRun` 纯函数，`palace/merge-types.ts` 加 `lattice` 并在 `platform/sync/merge/` 实现，`legion/runs` 登记进 palace 和 `NEVER_INFER_DELETE`。验收：可交换、可结合、幂等各一组用例；终态两两组合；同 `revision` 按 deviceId 破平；`progress` 按 `revision` 取高的那份。
4. run store：创建（带 `batchId` + `step` 走派生文件名）、读、列、状态迁移、取消。验收：内存文件系统下模拟两台设备，同 batchId 同 step 两次创建只得一个文件；撞 `running` 返回同一 runId，撞 `done` 返回原产出引用。
5. claim 泛化：claim 带 `capabilities`，`electFor(kind, claims, now)`，info 的采集端改成调它，目录从 `info/program/presence.ts` 挪进 `legion/claim`。验收：现有 handoff 测试搬过来仍绿；两台都能跑取连续在线最久，都不能跑返回 null。
6. 指派与 schedule：`dueRuns(runs, claims, now, deviceId)`，时点窗口，夜间时点按 kind 归一台，到点写一条 `wake` 铃。验收：这个函数的单测不许起 worker；本机重启退回、对端弃权接手、`lastProgressAt` 超阈值退回各一例；两台都到点只出一条 `wake`。
7. worker 契约与 runner：kind → worker 的注册表，取走 → 写 `running` → 跑 → 写终态 → 投铃；`ctx.report` 更新 `progress` 与 `lastProgressAt`，三十秒节流，状态变化不节流；深度检查、batch 续跑查询、按 `batchId` 级联取消。验收：假 worker 走完全程并投出 `run-done`；一秒内十次 `report` 只写一次盘、终态立刻写；`delegator` 已是子 run 的创建请求被拒；同 batchId 同 step 已 `done` 时不新建、直接拿 `output`；取消父 run 后子 run 也进 `cancelled`。
8. bell：ring / read / ack，`run-done` / `run-failed` / `wake` 三种。验收：投递后 ack 到达；未 ack 的出现在待恢复集合里；重复 ring 同一条不产生两份；三种铃各起一个没有用户输入的 soul 回合；取消和进度不产生铃。
9. ledger 折叠：`foldRun` 纯函数、三条判据、墓碑含时刻比较。验收：两台折出逐字节相同的一行；创建时刻更晚的同名新 run 不被误删；未 ack 的终态 run 不折。
10. translate 接入：kind `translate-book` 注册，`TranslateRun` 单例的工作体抽成一个程序 worker 并补 cancel 通道和 `report`，状态 UI 改成订阅 run 文件的 `progress`。验收：无头双设备测试跑完 A 写 pending、B 当选执行、产出与 `run-done` 的 ack 回到 A 的整条链；取消在跑到一半时生效；真机确认一次，iPad 派、PC 跑。

## 为什么不用现成的

DeepSeek Harness 的 jobs / workflow / schedule / agent-team 全部以「一机一进程一份 session 日志」为前提，Node 运行时，iPad 的 WKWebView 里跑不了；市面的任务队列（BullMQ、Temporal、pg-boss、Inngest）都要数据库或服务端。我们的 run 跨两台设备、靠一个同步文件夹、没有服务端。所以 run 的文件格式和指派规则自己写，只借三处设计：jobs 的 `run() → { cancel, done }` 作 worker 签名，agent-team 任务快照的 `revision` 作同级终态相撞时的裁决位，mailbox 的「先存完整消息、投递到才确认、queued 减 delivered 即待恢复」作 bell 的投递语义。

Claude Code 的 agent teams 是单机单会话：lead 就是主会话，teammate 跑在同一台机器上，任务认领靠同一文件系统上的文件锁，跨机器那条路是 cross-session messaging 经 Anthropic 服务器中继，不是文件同步。pi 上游 README 明写不做 sub-agents、不做内置待办、不做 workflow，多 agent 编排这层没人替我们做。

pi harness 借的是持久 session、lane、resume 和分支摘要；没借的是跨设备——它以一台设备一个进程为前提，run 的文件格式、指派与合并仍是自己的。
