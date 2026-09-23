# legion

> 2026-09-07 定案。同步引擎与删除模型在 [13](../platform/13-账户同步.md) 和 [50](../platform/50-删除.md)，记忆的两个仓在 [48](./48-记忆：观察与statement.md)。回收（gc）归 memory，不在本文。info 管线重做在 [60](../info/60-info：白宫与Red Boxes.md)；[17](../info/17-信息源系统.md) 的源配置、站点登录、正文抽取仍有效，只废「提名→主题」层。2026-09-14 改：架构定为 orchestrator-worker，soul 是唯一的 orchestrator，legion 是 worker 底座；认领由租约改为按能力指派；session 不同步；第一个调用方改为 translate。2026-09-14 再改：presence 改名 claim、mailbox 改名 bell（三种铃）、run 加 progress、batch 续跑、子 run 深度限两层。2026-09-15 改：答铃回合按 run 的 `deliverTo` 装配、回复写回提问的地方，铃之后由程序层装盒，第一个调用方改为 reading 的文献研究，交互层在 [68](../companion/68-Lumen与盒子的交互.md)。

---

## 定位

架构是 orchestrator-worker，三个角色。

soul 是唯一的 orchestrator：一个用户一个，带记忆，和用户说话。一个回合里它只做听、判断、派，不干活（[71](./71-soul.md)）。

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

worker 之间没有通道。分析员之间要共享东西走态势文件（[63](../info/63-情报局：研究室、专项组与态势.md)），不走信。run 之间不记依赖，先后顺序在程序 worker 的代码里。

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
| `idempotencyKey` | 派生文件名的键：子 run 是 `batchId` + `step`，其余由委托方自己起（collect 用锚点日期） |
| `kind` | 领域登记的类型，legion 只认这个 |
| `tier` | `local` 或 `synced`，由 `kind` 定 |
| `delegator` | soul（用户开口或一条铃起的回合），派它的那个程序 worker 的 run id，或 `program`（到点的 schedule、落盘的一个 ask 这类没人开口的领域接线，带一个名字） |
| `brief` | 任务书，按引用 |
| `state` | `pending` < `running` < `cancelled` < `failed` < `done` |
| `claimant` | 执行设备 deviceId + 开始时刻 |
| `attempts` | 尝试次数 |
| `progress` | 一行字，只留最后一行 |
| `lastProgressAt` | worker 每有实质进展推进一次 |
| `output` | 产出引用 |
| `deliverTo` | 投递目标 |
| 时间戳 | 创建、开始、终态、投递 |
| `revision` | 每次写加一；两个同级终态相撞时的裁决位 |
| `cancelRequested` | 取消请求。只置不清，执行方下次读到就调 worker 的 `cancel()` |
| `batchId` | 可选，父 run 的 id |
| `step` | 可选，父程序自己起的稳定名，同 `batchId` 下唯一 |

产出放领域自己的目录，run 只存引用：文件小，合并简单。

状态格是一条链，两台设备写同一个 run 时取格上更高的那个，对任意设备数都收敛。同一状态上两份相撞（弃权后被接手、原设备又回来跑完了）比 `revision`，高者赢；`revision` 相同按 claimant 的 deviceId 字典序小者赢，两侧都没有 claimant 时按规范序列化的内容序破平（不用 id，两侧的 id 是同一个）。赢的那一侧整份拿走，只有 `attempts`（取 max）、`createdAt`、`startedAt`、`deliveredAt`（取非空且较早的）和 `cancelRequested`（只置不清）单独折叠——这五个各自单调，跟着赢的那侧会倒退。它们也不进内容序的比较，否则合并出来的那份会是两台设备都没持有过的记录，合并就不再可结合。

有 `idempotencyKey` 时文件名取 `r-<hash(kind + NUL + key)>`（sha256 截 16 字节）：两台设备写同一个路径，同步的合并直接把它们收敛成一份，不需要额外的去重协议。没有 key 就用随机 id。子 run 的 key 是 `batchId` + `step`；别的调用方自己起 key，起了就是在说「这个 run 同一时候只该有一个」，第二次派拿回第一次那份。

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

接手不退回 `pending`：状态只升不降，接手是就地再写一份 `running`——换 `claimant`（deviceId + 开始时刻）、`attempts` 加一、`revision` 加一。两份都是 `running`，状态格打平，`revision` 裁决，新接手的那份赢。

三条：执行设备自己重启后接手名下的 `running`，本机自己判断，不依赖别人的时钟；执行设备弃权后，同 kind 新当选的设备接手它名下的 `running`；本机名下 `running` 而 `lastProgressAt` 与本次 claimant 开始时刻里较晚的那个超过阈值的，本机自己接手。三条都算一次尝试——接手就是开工，不记数的话一个在两台设备间弹来弹去的 run 永远到不了上限。worker 失败但没到上限时也是这个写法，原设备就地重试；到上限 runner 写 `failed`。创建之后没有人再写 `pending`。

正确性兜底是重跑无害：一个 run 跑两遍、两份结果合并后与跑一遍相同。

移动端派活就是写一个 `pending` run，PC 下次 pull 捡起来跑；移动端要看的只有 PC 上次在线时刻，来自 claim 心跳。

取消写进 run 文件的 `cancelRequested`，不是喊一声。执行设备下次 pull 读到就调 worker 的 `cancel()`；本机委托、本机执行的 run 直接调 `cancel()`，不经过文件；没有执行者的 `pending` run 直接进 `cancelled`。

取消只级联一层：取消一个父 run 时，runner 按 `batchId` 把它的子 run 一并取消。再往下没有，run 图只有两层。

`attempts` 到上限的 run 停在 `failed`，不再自动重试。重放沿用同一份任务书，是一个指回原 run 的新 run。

前提不成立时 run 自己进 `failed`，在产出里写明哪条前提不成立；委托方决定是否用新任务书重开。不开澄清通道。

## 粒度与折叠

一件任务一个 run——取一篇文章的正文就是一个 run，subagent 在 run 里面。不怕文件多，文件数靠折叠控，不靠把任务合粗。

热层 `legion/runs/<runId>.json`，一个 run 一个文件。冷层 `legion/ledger/<日期>.jsonl`，一天一个追加文件，一个折叠过的 run 一行。ledger 行存任务书的引用加内容哈希，不存正文；重放前校验哈希，取不到就拒绝重放并说明原因。

三条同时成立才折：终态、已投递（bell 的 ack 到了）、过了宽限期（24 小时，failed 是 7 天）。日期取 `endedAt` 的 UTC 日，两台设备算出同一个文件名。

`cancelled` 没有铃，投递时刻取 `endedAt`：取消的人当时就知道了。

行里的字段全是合并会收敛的那些：id、kind、终态、委托方、任务书引用与哈希、产出引用、`batchId`/`step`、`attempts`、创建/终态/投递三个时刻。claimant、revision、progress 不进——它们各设备不同，进去就折不出同一行。键序固定、毫秒取整。

死信就是 ledger 里的 failed 行，不另开目录，UI 从 ledger 读。

ledger 兼做墓碑。同步不传播文件级删除（坑 208），所以热层删掉的 run 会被另一台设备推回来；判据是「热层有这个 id、ledger 里也有，且热层这份的创建时刻不晚于 ledger 行的」——时刻这一半防的是 key 回收后的同名新 run 被当成旧 run 删掉。两边各自据此删掉自己的热层文件，删远端走 `requestRemotePurge`。ledger 行按行取并集合并（palace 的 `records` + `lines`），任何设备都能折，规则是纯函数，两台设备折出逐字节相同的一行。同一 id 出现两行就是前后两个 run 共用了派生 id，墓碑按创建时刻最晚的那行判。

ledger 目录自己也进 `NEVER_INFER_DELETE`：丢一行就等于把它删掉的那个 run 放回来。

`legion/runs` 进 `NEVER_INFER_DELETE`：删除只认 ledger 墓碑，不认按持有清单的删除推断，否则一台折了一台没折时，推断会把对端的未折读成一次撤销。

代价在同步请求数：app 走 Drive API 一文件一请求，要压的是热层的文件数，不是磁盘字节。

## bell

`legion/bell`，三个动作 ring / read / ack。收件人始终是某台设备上的 soul，用户看不见。

一条铃有 `type`，闭集三种：

- `run-done`：runId、kind、有上限的 brief、output 引用。soul 的代码把 brief 追加进它的 lane，起一个没有用户输入的回合；brief 超长就截断，附一句完整产出在 output 引用里。
- `run-failed`：runId、kind、失败原因（哪条前提不成立、`attempts` 用尽）。soul 决定要不要说。
- `wake`：schedule 到点，带 schedule id 和它登记的任务书。夜里没有用户时 soul 被叫醒的唯一入口。

凡是不由用户开口而起的 soul 回合都从 bell 进来，soul 只有这一个收件口。取消和进度不起回合，都在 run 文件里，不是铃。

答铃回合的落点由 run 的 `deliverTo` 决定，不再一律开在门口。`deliverTo` 记的是这个 run 从哪儿派出来的：某本书的某条线程（划线线程带 annotationId，也可能是书的总线程），或门口。soul 按那个地方装配——是书就按阅读桌装配，桌上有那本书；是门口就按门口——然后把回复追加进那条对话（[68](../companion/68-Lumen与盒子的交互.md)）。

程序派的 run（`delegator` 是 `{ kind: "program", name }`）不起回合。`run-done` 只 `delivered`、`ack`、`markDelivered`，产出由派它的领域自己处置——日更那张卡是 `src/info/boxes/red-box.ts` 放的。`run-failed` 也不起回合，程序层往盒里放一项标「要你定」，origin 是门口当天，封面是失败原因本身。runner 把 `delegator` 抄在铃的 payload 上，和 `deliverTo` 同一个理由：`local` 档的 run 不落盘。

跨设备的 run 完成时，铃投给执行设备上的 soul，它说出来的话经对话文件同步到另一台。iPad 想知道 PC 跑到哪，读 run 文件的 `progress`——随同步到达，最多晚一个 pull 间隔——不等 bell。

先把完整消息存下来，目标端持久记下之后才确认投递；queued 减 delivered 就是待恢复集合。run 的折叠判据依赖 ack，所以这条顺序不能倒。

词表只有 queued / delivered / acked。cable 的处置状态归 info（[63](../info/63-情报局：研究室、专项组与态势.md)），和投递语义不是一回事。

bell 不是 Red Box。Red Box（[60](../info/60-info：白宫与Red Boxes.md)、[68](../companion/68-Lumen与盒子的交互.md)）是给用户的交付物，bell 是「活干完了」的通知。采集经理跑完，程序层把 cable 装进 Red Box，同时一条 `run-done` 进 bell。答铃之后也是程序层往盒里放一项，指回 soul 刚写进去的那条回复；失败或拿不准的标「要你定」。

## claim

`legion/claim`，每台设备一份 claim 文件，声明在线时刻和本机能跑的 kind。它是今天 info 那份 claim 文件（「我是采集端」）的泛化，选举算法从 `info/program/presence.ts` 和 `info/briefer/handoff.ts` 泛化。

今天那套是这样跑的：每台设备只写以自己命名的那个文件，一写者无合并，两台同时写产生两个文件而不是一次冲突。选举是「所有 claim 文件 + 时钟」的纯函数，每台设备各自算出同一个答案，输的那台站着不动。`claimedAt` 每次进程启动重置，所以赢的是连续在线最久的那台；`claimedAt` 相同按 deviceId 破平。心跳一小时一次，超过 24 小时没动静算弃权，下一台顶上；`claimedAt` 为 null 表示这台不参选（用户关了后台采集），立刻退出选举而不等弃权阈值。开着同步的设备在本次会话第一次 pull 落地之前不写 claim——对一个还没读过的文件夹宣称所有权，正是两台机器同时认为自己是采集端的成因；等不到就在 30 分钟后不再等。重启的设备排到队尾，不把活从接手的那台手里抢回来。

泛化之后 claim 不再只说「我是采集端」，而是说这台设备能跑哪些 kind（有没有 webview fetch、有没有 GPU、是不是常开）；哪台设备跑哪个 kind 的 run 就是这份声明的下游。

## schedule

`legion/schedule`，提供时点窗口、FIFO 和每资源串行。

schedule 的产物是一条 `wake` 铃，不是直接起 run；派什么由 soul 决定。挂在夜间时点上的 run 按 `kind` 走 claim 选举，只有当选的那台创建，两台都到点也只跑一遍。

夜间那个时点是共用的：memory 的 dream 挂在上面，各领域自己的 housekeeping（info 日切缓存、退役设备的残留文件、run 折 ledger）也挂在上面。schedule 只提供时点和串行，不知道挂上来的是什么。

夜班的编排是情报局登记的一个纯程序 worker，就是 [63](../info/63-情报局：研究室、专项组与态势.md) 的采集经理：读源注册表和态势，扇出 collect → analyze → synthesize 子 run，写 tasking 队列，装盒，零模型调用。soul 夜里被叫醒只做一件事：派它，可带参数（哪个研究室多给预算、哪个跳过）。判断在子 run 里，编排在程序里，每晚同一套流程，反馈按产物版本归因才成立。

## execute

`legion/execute`，worker 的签名是 `run(brief, ctx) → { cancel, done }`。

runner 是 `kind` → worker 的注册表加一圈外壳：取走 → 写 `running` → 跑 → 写终态 → 投一条铃。注册一个 worker 的同一次调用里声明这个 kind 要哪些能力标签——有 worker 的设备才可能跑它，能不能跑由标签选举答，两件事从不分开成立。`ctx` 里有 `report(text)`，和给 agent worker 的 `reportTool(工具名, 轮数)`：回合是 worker 自己跑的，措辞是 runner 的。子 run 只从 `ctx.delegate` 出，agent worker 调它直接被拒。runner 还管三件闸：`delegator` 深度超两层的创建请求拒绝，带 `batchId` + `step` 的创建先查已有的那一份，取消按 `batchId` 级联一层。

轮询挂在 sync 的 15 秒 tick 上，每拍问 `dueRuns` 要本机该动的 run。同一 kind 本机同时只跑一个：贵的都是重活，一台设备同时跑两个就是别的 kind 排不上队；不同 kind 并排跑不拦。`local` 档不落同步文件夹——runner 内部给它一份 Map 上的 run store，delegate 当场起、当场把 `done` 交回去，别处不再分档。

已经在的：

- `turn.ts` 的 `runAgentTurn`：一次工具循环回合，跑在 harness 的一条 lane 上，契约在 `contract.ts`；轮数上限走 `before_request`，预算裁剪走 `toProviderMessages` 每轮重算不写回，遥测挂 `message_end`。
- `watchdog.ts`：流式调用静默超时就 abort 重试，provider 说是确定性失败的不重试，用户 Stop 抛 `StoppedError`。
- `observable-run.ts`：长管线共用的 subscribe/snapshot 外壳和活跃度计数。
- `limiter.ts`：整组的并发与起跑间隔，429 是让整组慢下来，不是这一次调用倒霉。
- `subagent/`：隔离上下文的子 agent 运行器。

进程内那半搬到 pi-agent-core（现 0.87.1）的 `AgentHarness`：soul 一条 lane，本地快车道的 worker 各一条（`lane(name, { createAt: tip })` 继承上下文，可换模型和工具集）；一条铃进 soul 的 lane 是 `appendCustomEntry` 加 `nextRun`；跨进程重启靠 `create` 返回的 open 列表和 `resume()`，默认不重跑工具，写一条合成 toolResult 说中断了，要重执行的工具自己声明 `replay: "safe"`；worker lane 的分支摘要不会自己回来，由 app 调 `generateBranchSummary` 再写进 soul 的 lane。跨设备那半仍是 run 文件。两边的接缝只有一处：run 完成后由谁把 brief 追加进 soul 的 lane。

落位：`legion/execute/harness.ts` 是工厂，建 `AgentHarness` 和 `JsonlSessionRepo`；`legion/execute/turn.ts` 用它提供今天 `runAgentTurn` 的同一份契约。`src/ai/agent.ts` 里手写的 `runAgentLoop` / `runAgentTurn` 退役，调用方改从 `legion/execute` import，`src/ai` 只剩 provider、鉴权、streamFn、消息转换这类接线。`legion/subagent` 是 lane 上的薄壳：子 agent 起自己的 harness 和 session，lane 名 `worker:<定义名>`、session 组 `worker`，工具集是调用方给的最小集；不挂在调用方的 harness 上，因为 pi 的 lane 只能换模型、思考档和工具名，系统提示和工具注册表是 harness 级的（坑 307）。brief 仍由 `subagent/brief.ts` 出，pi 的分支摘要是压缩摘要，说不出「没证据」「轮数用尽」这些区别。手写循环 `agent-turn.ts` 已删。

soul 的那条 lane 已经常驻：`legion/execute/held.ts` 把一个 harness 跨回合持有（session 组 `soul`、lane 名 `soul`，`src/soul/harness.ts` 进程内懒建一份），`runAgentTurn` 的 `harness` 参数让 soul 的五个回合面（阅读聊天、info 聊天与语音、排练教练、复述）跑在它上面，subagent 和后台 pass 仍各自开 harness。每回合先把 lane 导航回 session 根再 accept，模型收到的只有本回合装配的消息加自己的工具轮次，session 文件按回合各存一条根分支、不回灌上下文（[71](./71-soul.md)）。工具、系统提示和模型注册表是 harness 级的（坑 307），所以 harness 建一次，按回合换入。进程启动时把该组最新 session 打开，随即另起一个新 session 给本进程用——session 里的内容从不回读，留着只会让一个文件无限长。上个进程留下的 open operation 不再 abort，而是在那份旧 session 自己的 harness 上后台 resume 跑完（坑 308）：答案落到当初提问的地方，读者不被告知任何异常。收件方是 accept 之前写在 lane 上的一条 custom entry（`reading-partner.delivery`，装的是 BoxOrigin），恢复时按它重建那个地方的 delivery。没有这条、那个地方没人注册 opener、同一条 run 已经试过两次（`reading-partner.recovery-attempt`）、或者根本不是 run 的，照旧 abort，不发请求。该组只留最新五个文件，多的删掉；被恢复的那份是第二新的，扫不到它。

两个未定点跟着第一个真调用方定：看门狗重试从原始消息重建 Agent，但轮次跨重试累加；`transformContext` 的截断不写回 Agent 的消息记录，每轮重算。

## session

session 是 agent 派活过程的运行时数据，对用户不重要，不同步。palace 登记一行 `session`，sync 为 `local`，目录 `session/`。

对话文件是数据，照旧按归属存、照旧同步（[71](./71-soul.md)）。两者之间是单向投影：soul 说的每一句落地时写进归属文件；反向不投影——另一台设备写的对话到了本机，soul 下回合装配上下文时从数据层读，走 sequence。

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

第一个调用方是 reading 的文献研究（kind `research-literature`，`local` 档，见 [68](../companion/68-Lumen与盒子的交互.md)）。第一个跨设备调用方是 translate（翻整本书）：iPad 上 soul 派一个 `pending` run，PC 按能力当选执行，产出回领域目录，brief 经 bell 回 PC 的 soul。info 的 kind 清单在 [63](../info/63-情报局：研究室、专项组与态势.md) 已列好，等 Red Boxes 落地时登记。

## 现状与顺序

已落地（2026-09-15）：第 1 到 9 步。session-fs 与 palace 的 `session` 行、harness 工厂、`legion/execute/turn.ts` 顶掉手写循环、`legion/subagent` 成为 worker lane 薄壳、旧循环全部删除；pi-ai 与 pi-agent-core 0.85.1；LAYER 表有 legion 三行。第 8 步：`legion/bell` 三个动作加 `delivered`、palace 的 `bell` 行、`src/soul/bell.ts` 的 `answerBell` 把一条铃变成门口的一个回合，外壳按 sync 的 15 秒 tick 调它。

第 3 步：`src/legion/run/types.ts` 的字段表与状态链、`merge.ts` 的 `mergeRun`，palace 的 `lattice` 策略（`platform/sync/merge/lattice.ts` 是注册表，领域交 `merge(a, b)`，base 不参与）和 `run` 行（`legion/runs/`，data 通道，进 `NEVER_INFER_DELETE`）。合并的裁决顺序是状态链 → `revision` → claimant 的 deviceId 小者 → 规范序列化的内容序；`attempts`、`createdAt`、`startedAt`、`deliveredAt`、`cancelRequested` 单独折叠，不跟赢的那一侧。第 4 步：`src/legion/run/store.ts` 的 `createRunStore(io)`，文件名 `r-<hash(kind + \0 + idempotencyKey)>`，撞已有文件一律原样交回由调用方看 `state`。

第 5 步（2026-09-15）：claim 落在 `src/legion/claim`，文件从 `info-collector-<id>.json` 搬到 `legion/claim/<deviceId>.json`（palace 行改名 `claim`，sync 仍是 data；旧路径留作 legacy 并下了同步通道）。capability 的表示法是能力标签而不是 kind 名单：kind 注册时声明需要哪些标签（`registerKindCapabilities`），设备声明自己有哪些（今天只有 `webview-fetch`），`electFor(kind, claims, now)` 在覆盖需求的候选里按连续在线最久选。info 的 `collect` 登记为不需要任何标签，和泛化之前的候选集一样。

第 6 步（2026-09-15）：`src/legion/schedule`。`dueRuns` 和 `reclaimAfterRestart` 是纯函数，阈值作参数，不起 worker 也不碰盘；它读的 run 形状是 `Run` 的一个 `Pick`（只用 type import，这个目录仍不在运行时 import `legion/run`）。schedule 是内存注册表加 `dueSchedules`，到点在当选设备上摇一条 `wake` 铃，去重靠 `legion/schedule/fired.json`（本地、每设备一份）记的上次 anchor。info 的 daily round 登记成一条 schedule，挂在原来的 tick 上；干活那半和它自己的日期记录在第 12 步换成了一个 run，日期记录也在那时去掉了。

第 7 步（2026-09-15）：worker 契约与 runner 落在 `src/legion/execute/worker.ts` 和 `runner.ts`。`registerWorker` 一次调用登记 worker 和这个 kind 的能力标签；runner 的 `delegate` 管三件闸，`tick` 走 `dueRuns`，`cancel` 按 `batchId` 级联一层。`report` 三十秒一写、终态立刻写并带上最后一行。store 加了 `retake`（接手：同状态换 claimant、attempts 和 revision 各加一），`dueRuns` 的 `back` 动作改成 `retake`、`ScheduledRun` 换成 `Run` 的 `Pick`、`bumpAttempts` 去掉。`App.tsx` 和 `PhoneApp.tsx` 在 `startBellWatch` 旁边起 `startRunner`，这是 `legion/run` 的第一个 import，run 的合并从此注册进 sync；注册表在生产里是空的，空表时轮询先看表再看盘，不花 IO。

第 9 步（2026-09-15）：`src/legion/ledger`。`foldRun` 是纯函数，宽限期在 `fold.ts` 顶上一处常量；`ledgerLineText` 定键序和取整；`tombstonedRunIds` 是另一个纯函数；`store.ts` 是 `legion/ledger/<日期>.jsonl` 的读写，`deadLetters(day)` 就是死信视图；`housekeeping.ts` 的 `foldPass` 一趟里先折后删，挂在 info 那条日 tick 上，每设备一天一次。palace 加 `ledger` 行（data 通道、`records` + `lines`、`neverInferDelete`、`gc: never`）。run store 加 `markDelivered` 和 `remove`，`RunIo` 加 `remove`；`src/soul/bell.ts` 答完铃 ack 之后把 `deliveredAt` 写进 run 文件——这个字段此前没有任何人写，折叠在生产里永远不会触发。远端那半在 `foldPass` 里按 docs/50 的顺序走 `requestRemotePurge`，先远端后本地。顺带把 `legion/subagent/ledger.ts` 改名 `quota.ts`（它数的是一个回合里子 agent 的轮数，和这个 ledger 无关）。

第 10 步（2026-09-15）：research 接入，第一个调用方（docs/68）。reading 在 `src/reading/papers/research-worker.ts` 登记 kind `research-literature`（agent worker、`local` 档），身体是原来的研究子 agent，一个 run 一个 `createSubagentQuota(RESEARCH_TURN_ROUNDS)`；子 agent 的工具事件接 `ctx.reportTool`，`cancel` 走 AbortSignal，拿不到证据就抛，让 runner 记这一次 attempt。soul 的 `delegate` 工具（`src/soul/delegate.ts`）挂在每个回合上，模型只给 `kind` 和 `task`，`deliverTo` 由 soul 按所在的地方填——书是 `DeskItem.origin`，门口和简报由调用方传 `assembleTurn({ origin })`。brief 写进 `legion/briefs/<uuid>.md`、产出写进 `legion/outputs/<runId>.md`，两行都是 local 通道的 palace 行。阅读回合不再挂 `research_literature`，`find_paper` 留着，`RESEARCH_PROMPT` 改成叫它派 run 并当场告诉读者答案稍后回来。

答铃按 `deliverTo` 装配：`src/soul/delivery.ts` 是地方 → 装配器的注册表（soul 不许 import reading），reading 在 `src/reading/deliver.ts` 登记 `book`，回合就是那本书那条线程的阅读回合，铃作为一条不落盘的尾消息挂在会话末尾。回复落盘之后、ack 之前，程序层往 `src/box/` 放一项（`boxId` 取 runId，封面是回复的第一句，`run-failed` 标 `needsDecision`）。`local` 档的 run 不落盘，runner 因此把 `deliverTo` 抄在 `run-done` / `run-failed` 的 payload 上。

第 10 步之二：tasking 接入（2026-09-16）。info 在 `src/info/tasking/` 登记 kind `tasking`（agent worker、`local` 档、不要能力标签），身体是一个子 agent，工具是「先查已有 cable 和稿」那一套：`search_cables` 扫本机三十天的电报，`read_cable` 取正文（先当天的文章缓存，再随简报发布的 `info-bodies.json`），`read_picture` 读研究室态势或列出开着的室，外加 `read_page` 抓一个电报指到的 URL。仓库里没有 web search，也没加；查不到就在第一行说查不出来，后面列查过哪些本地来源。`read_page` 从 `info/briefer/companion-tools.ts` 搬到 `info/extract/read-page-tool.ts`：秘书和 tasking 两个 agent 都挂它，而秘书的 duty 要写出 kind 名，briefer 因此 import tasking，反向再 import 就是环。

答铃的落点补齐：`src/info/briefer/deliver.ts` 登记 `briefing`，按那天的简报桌装配（role `secretary`，桌上是那天的简报，没有就是「今天还没有简报」那个同 id 的会话），回复追加进 `info-<日期>` 的 `briefing-<日期>` 线程。简报页和语音通话的回合都传 `origin: { place: "briefing", date }`，从简报派的 run 不再在门口答。简报没有「正看着」这回事，盒里那一项照放。产出落盘那段收到 `legion/execute/outputs.ts` 的 `writeRunOutput`，research 和 tasking 共用。`delegate` 的描述文本不再提文献搜索，改成通用措辞，kind 清单仍在参数说明里。docs/63 的三态判定（答上了 / 没答上 / 未判定，idempotencyKey 不释放）没做，项走 told / dismissed；同一问题当天去重也没做。

第 12 步：collect 接入（2026-09-16）。info 在 `src/info/program/collect-worker.ts` 登记 kind `collect`（程序 worker、`synced` 档、不要能力标签），身体是 `InfoPipeline` 的一层壳：读任务书里的 scope（`full` / `retriage`）、调对应的方法、把管线的四个相位翻成一行 `ctx.report`、产出是当天的 `briefing-<date>.json`。`registerKindCapabilities(COLLECT_KIND, [])` 并进 `registerWorker`，`handoff.ts` 只留 kind 名。三个口都改成派 run：日 tick、`generate_briefing`（经 `collectorView().request`）、读端 ask（`presence.ts` 加一条 `requestCollect` 依赖，不自己 import runner）。

`idempotencyKey` 三种：日更 `collect:<锚点日期>`，重跑 `collect:<日期>:<scope>:<时刻>`，读端 ask `collect:ask:<askedAt>:<scope>`。日更那条就是「今天跑过了」的全部记号，本机的 `info-daily-round.json` 和 `dailyAction` 一起删了；`daily.ts` 只剩锚点。`delegator` 用新加的 `{ kind: "program", name }`。

单飞查过两处：runner 的 `start` 有每设备每 kind 一条（`DEFAULT_PER_KIND`），排不上的 run 留在 `pending`，下一拍再看，不丢；`dueRuns` 只让当选设备取 `pending`，读端设备不抢。管线还有一个不经 run 的入口——`init()` 在 app 回前台时续跑断点——所以 worker 层再兜一层：`generate()` 说 `busy` 就等它给回的那条 `done`，完了再要一次，不放弃这个 run。

偏离：wake 铃照旧摇，soul 照旧在门口答一次，采集经理不是 soul 用模型回合派的（docs/63 的设计），铃的文案改成「run 已由日 tick 派出」。跑完那条 `run-done` 不再起第二个回合：程序派的 run 按「bell」一节答铃（2026-09-16 改，此前日更每天早上两个回合、门口多一句「采集跑完了」、盒里多一张指回门口的卡）。`BriefingView` 的 snapshot 仍订阅 pipeline，没改成订阅 run 文件。`collectorView().request` 不再有 `busy` 这个回答：两次 `generate_briefing` 是两个 run，第二个排队而不是被拒。任务书写在 `legion/briefs/`，那一行 palace 是 local——三个口都只在 `amICollecting()` 为真的机器上派，选举把 run 发回同一台，所以今天够用；选举中途换机器时那个 run 在新机器上读不到任务书而失败。分析员和综合拆成子 run 留待下一步。

第 11 步（2026-09-18）：translate 接入。reading 在 `src/reading/translate/tool-live.ts` 登记 kind `translate-book`（程序 worker、`local` 档、不要能力标签、`delegable: false`），身体是原来那个 fire-and-forget 的 `runTranslation`：打开文档、切块、一打模型调用、替换，整段搬进 worker，进度翻成一行 `ctx.report`（`openingLine` / `segmentedLine` / `translatedLine`，纯函数在 `book-run.ts`）。工具的 execute 只剩 `find` 加写 run —— 读整本 EPUB 字节再 `segmentDocument` 那一步从回合里搬走了，「已经是双语」和「没有可翻的」改由 worker 说。

单例 `translateRun` 删了。`TranslateStatus.tsx` 订阅 `src/reading/translate/watch.ts`，它在 runner 写 run 之后重读 run 记录；进度从 `done/total` 计数器变成一行字，三十秒一行是节流定的。替换后的文档写进 `legion/outputs/<runId>.json`，run 的 `output` 指着它，把读者搬到新文档那一步读它。

legion 加了三样。`WorkerRegistration.delegable`（默认 true）和 `delegableWorkerKinds()`：`translate-book` 的任务书是程序写的 JSON，模型写不出来，soul 的 `delegate` 因此只列 delegable 的那半。`Runner.list(filter)` 和 `Runner.subscribe(fn)`：`local` 档的 run 在 runner 自己的 Map 里，屏幕没有文件可看，所以由 runner 在每次写 run 之后告一声。

偏离：`local` 档，不是双设备，「iPad 派、PC 跑」那条验收没做。`delegator` 是 `program`，收尾那句话仍由 worker 直接写进那条线程，不经铃起回合；`deliverTo` 照填在 run 上，铃对 program 的 run 不读它。失败按 legion 走：worker 报一行原因再抛，跑满三次进 `failed`，读者从盒里那张卡知道；「书不在架上了」「已经是双语」「没有可翻的」三种不算失败，说一句就把 run 做完——重跑它们只会花一打模型调用再说同一句话。取消通道接上了（`AbortController` 进 `translateArticleEpub` 的 `signal`），界面上没有按钮调它。

未开始：session 到对话文件的投影。开发时手摇一条铃走 `scripts/ios-sim.sh eval 'window.__bell.ring(...)'`。

1. 底座：`platform/app/session-fs.ts`、palace 的 `session` 登记行、`legion/execute/harness.ts` 的 harness 工厂。验收：杀掉进程再起，`resume()` 接上，未完成的工具写成合成 toolResult。
2. turn 换成 harness 背后的那一份：`legion/execute/turn.ts` 顶掉 `src/ai/agent.ts` 的手写循环，调用方改 import，`legion/subagent` 退成 lane 上的薄壳。验收：行为不变，`tests/ai/agent.test.ts` 那 24 条行为测试搬过去仍绿。
3. （已落地）run 类型与合并：字段含 `progress`、`batchId`、`step`，`mergeRun` 纯函数，`palace/merge-types.ts` 加 `lattice` 并在 `platform/sync/merge/` 实现，`legion/runs` 登记进 palace 和 `NEVER_INFER_DELETE`。验收：可交换、可结合、幂等各一组用例；终态两两组合；同 `revision` 按 deviceId 破平；`progress` 按 `revision` 取高的那份。
4. （已落地）run store：创建（带 `batchId` + `step` 走派生文件名）、读、列、状态迁移、取消。验收：内存文件系统下模拟两台设备，同 batchId 同 step 两次创建只得一个文件；撞 `running` 返回同一 runId，撞 `done` 返回原产出引用。
5. claim 泛化：claim 带 `capabilities`，`electFor(kind, claims, now)`，info 的采集端改成调它，目录从 `info/program/presence.ts` 挪进 `legion/claim`。验收：现有 handoff 测试搬过来仍绿；两台都能跑取连续在线最久，都不能跑返回 null。
6. 指派与 schedule：`dueRuns(runs, claims, now, deviceId)`，时点窗口，夜间时点按 kind 归一台，到点写一条 `wake` 铃。验收：这个函数的单测不许起 worker；本机重启退回、对端弃权接手、`lastProgressAt` 超阈值退回各一例；两台都到点只出一条 `wake`。
7. （已落地）worker 契约与 runner：kind → worker 的注册表，取走 → 写 `running` → 跑 → 写终态 → 投铃；`ctx.report` 更新 `progress` 与 `lastProgressAt`，三十秒节流，状态变化不节流；深度检查、batch 续跑查询、按 `batchId` 级联取消。验收：假 worker 走完全程并投出 `run-done`；一秒内十次 `report` 只写一次盘、终态立刻写；`delegator` 已是子 run 的创建请求被拒；同 batchId 同 step 已 `done` 时不新建、直接拿 `output`；取消父 run 后子 run 也进 `cancelled`。
8. bell：ring / read / ack，`run-done` / `run-failed` / `wake` 三种。验收：投递后 ack 到达；未 ack 的出现在待恢复集合里；重复 ring 同一条不产生两份；三种铃各起一个没有用户输入的 soul 回合；取消和进度不产生铃。
9. （已落地）ledger 折叠：`foldRun` 纯函数、三条判据、墓碑含时刻比较。验收：两台折出逐字节相同的一行；创建时刻更晚的同名新 run 不被误删；未 ack 的终态 run 不折。
10. （已落地）research 接入（第一个调用方）：reading 登记 kind `research-literature`，agent worker、`local` 档，身体是 `src/reading/papers/research-agent.ts`；soul 换成通用 `delegate` 工具加 kind 目录，阅读回合不再挂 `research_literature` 子 agent 工具；run 带 `deliverTo`，答铃按它装配并把回复写回那条线程。验收：阅读回合里派一个文献研究，回合立刻结束；结果回来追加进那条划线线程，同时盒里多一项。
11. （已落地，`local` 档那半）translate 接入：kind `translate-book` 注册，`TranslateRun` 单例的工作体抽成一个程序 worker 并补 cancel 通道和 `report`，状态 UI 改成订阅 run 文件的 `progress`。验收：无头双设备测试跑完 A 写 pending、B 当选执行、产出与 `run-done` 的 ack 回到 A 的整条链；取消在跑到一半时生效；真机确认一次，iPad 派、PC 跑。

## 为什么不用现成的

DeepSeek Harness 的 jobs / workflow / schedule / agent-team 全部以「一机一进程一份 session 日志」为前提，Node 运行时，iPad 的 WKWebView 里跑不了；市面的任务队列（BullMQ、Temporal、pg-boss、Inngest）都要数据库或服务端。我们的 run 跨两台设备、靠一个同步文件夹、没有服务端。所以 run 的文件格式和指派规则自己写，只借三处设计：jobs 的 `run() → { cancel, done }` 作 worker 签名，agent-team 任务快照的 `revision` 作同级终态相撞时的裁决位，mailbox 的「先存完整消息、投递到才确认、queued 减 delivered 即待恢复」作 bell 的投递语义。

Claude Code 的 agent teams 是单机单会话：lead 就是主会话，teammate 跑在同一台机器上，任务认领靠同一文件系统上的文件锁，跨机器那条路是 cross-session messaging 经 Anthropic 服务器中继，不是文件同步。pi 上游 README 明写不做 sub-agents、不做内置待办、不做 workflow，多 agent 编排这层没人替我们做。

pi harness 借的是持久 session、lane、resume 和分支摘要；没借的是跨设备——它以一台设备一个进程为前提，run 的文件格式、指派与合并仍是自己的。
