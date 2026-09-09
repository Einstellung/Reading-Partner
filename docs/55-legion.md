# legion

> 2026-09-07 定案。同步引擎与删除模型在 [13](./13-账户同步.md) 和 [50](./50-删除.md)，记忆的两个仓在 [48](./48-记忆：观察与statement.md)。回收（gc）归 memory，不在本文。info 管线重做在 [60](./60-info：白宫与Red Boxes.md)；[17](./17-信息源系统.md) 的源配置、站点登录、正文抽取仍有效，只废「提名→主题」层。

---

## 定位

legion 是 agent 调度中心：跑被委托出去的活，盯着它跑到底，把结果送回来，并且知道该在什么时候、在哪台设备上跑。

它不认识蒸馏、回收、info 管线是什么。memory 把自己的蒸馏 pass 登记成一个 run kind，legion 照跑，不知道跑的是什么。领域知识全在领域侧，legion 只认 `kind`。

`@` 提及解析不做。

## 六项地基

1. run 是一等同步对象：一个 run 一个文件，状态在盘上不在进程内存里。
2. 脱手 + 回帖：委托出去不占用户等待，跑完以卡片回到对话。
3. 并行 / join，带取消和去重：去重靠 `idempotencyKey`，join 靠 `batchId`。
4. 每资源写序：同一份资源同一时刻只有一个写者。并行的 run 把产出 post 到黑板，evaluate 之后由单个写者 integrate，执行侧就是 schedule 的每资源串行。
5. 统一可观测：每个 run 登记自己的输入和委托方，热层加 ledger 合起来是一张因果图——谁触发了谁，哪份产出喂进了哪次运行。
6. 调度：定时 / 空闲 / 仅采集端三种触发。

另有两件横穿的：死信队列，和一律按引用传参——任务书和产出都是路径或 id，run 文件里不存内容。

## run

一次被委托出去、在用户视线之外发生、最后要回来交差的工作。

任务书发出即冻结，要改就是新 run。状态在可同步的文件里。无产出的 run 是失败，不是空成功。

三件它不是的事：

- 不是 subagent。subagent 是执行手段之一，一个 run 里可以有零个或多个，也可以整个不用模型。
- 不是管线的一段。管线是领域知识。
- 不是对话消息。卡片是投递结果，run 记录是审计凭据和因果图节点。

字段：

| 字段 | 含义 |
|---|---|
| `id` | 全局唯一，即文件名 |
| `idempotencyKey` | 创建时去重，同一个 key 只有一个 run |
| `kind` | 领域登记的类型，legion 只认这个 |
| `delegator` | 用户动作 / 一条 schedule 的名字 / 父 run 的 id |
| `brief` | 任务书，按引用 |
| `state` | `pending` < `running` < `done` \| `failed` \| `cancelled` |
| `claimant` | 认领设备 + 租约到期时刻 |
| `attempts` | 尝试次数 |
| `output` | 产出引用 |
| `deliverTo` | 投递目标 |
| 时间戳 | 创建、开始、终态、投递 |
| `revision` | 并发写的 compare-and-set 依据 |
| `batchId` | 可选，join 按 batch 等 |

产出放领域自己的目录，run 只存引用：文件小，合并简单。

两台设备写同一个 run 时，状态取格上更高的那个：`running` 盖 `pending`，终态盖 `running`。两个终态相撞（租约过期后原认领者仍跑完了）和其余字段一样，按 `revision` 的 compare-and-set 定，先落的赢。

## 认领、租约与取消

设备按 presence 广告的能力挑 `pending` 的 run 认领，写进 `claimant` 并带一个租约到期时刻。租约要续，过期的 run 回到 `pending` 让别人捡——认领者关机了就是这个样子，`attempts` 加一。

取消写进 run 文件，不是喊一声。认领设备下次续租时读到，调执行器的 `cancel()`；没有认领者的 run 直接进 `cancelled`。

`attempts` 到上限的 run 停在 `failed` 并进死信队列，不再自动重试。重放沿用同一份任务书，是一个指回原 run 的新 run。

## 粒度与折叠

一件任务一个 run——取一篇文章的正文就是一个 run，subagent 在 run 里面。不怕文件多，文件数靠折叠控，不靠把任务合粗。

热层 `legion/runs/<runId>.json`，一个 run 一个文件。冷层 `legion/ledger/<日期>.jsonl`，一天一个追加文件，一个折叠过的 run 一行。

三条同时成立才折：终态、已投递（mailbox ack 到了）、过了宽限期（约 24 小时，failed 更长）。

ledger 兼做墓碑。同步不传播文件级删除（坑 208），所以热层删掉的 run 会被另一台设备推回来；判据是「热层有这个 id、ledger 里也有」，两边各自据此删掉自己的热层文件，删远端走 `requestRemotePurge`。ledger 行按 id 取并集合并，任何设备都能折，规则是纯函数，两台设备折出同一行。

代价在同步请求数：app 走 Drive API 一文件一请求，要压的是热层的文件数，不是磁盘字节。

待定：ledger 行只存元数据（倾向）还是连任务书 payload 一起存。

## mailbox

`legion/mailbox`，四个动作 post / read / told / ack。

先把完整消息存下来，目标端持久记下之后才确认投递；queued 减 delivered 就是待恢复集合。run 的折叠判据依赖 ack，所以这条顺序不能倒。

Red Box 消费侧的 item 状态集合待定：三个问题（主讲被打断算 told 还是 asked、要不要 later、几天后自动 dismiss）在 info 侧，答完再定 mailbox 的状态词表。其余部分不等它。

## presence

`legion/presence`，每设备一个心跳文件，广告自己的能力。租约算法从 `info/program/presence.ts` 和 `info/briefer/handoff.ts` 泛化。

今天那套是这样跑的：每台设备只写以自己命名的那个文件，一写者无合并，两台同时写产生两个文件而不是一次冲突。选举是「所有 claim 文件 + 时钟」的纯函数，每台设备各自算出同一个答案，输的那台站着不动。`claimedAt` 每次进程启动重置，所以赢的是连续在线最久的那台；`claimedAt` 相同按 deviceId 破平。心跳一小时一次，超过 24 小时没动静算弃权，下一台顶上；`claimedAt` 为 null 表示这台不参选（用户关了后台采集），立刻退出选举而不等弃权阈值。开着同步的设备在本次会话第一次 pull 落地之前不写 claim——对一个还没读过的文件夹宣称所有权，正是两台机器同时认为自己是采集端的成因；等不到就在 30 分钟后不再等。重启的设备排到队尾，不把活从接手的那台手里抢回来。

泛化之后 claim 不再只说「我是采集端」，而是说这台设备能跑哪些 kind（有没有 webview fetch、有没有 GPU、是不是常开）；run 的 `claimant` 和租约到期就是这份心跳的下游。

## schedule

`legion/schedule`，FIFO 加每资源串行。触发三种：定时、空闲、仅采集端。

其中夜间那个时点是共用的：memory 的 dream 挂在上面，各领域自己的 housekeeping（info 日切缓存、退役设备的残留文件、run 折 ledger）也挂在上面。schedule 只提供时点和串行，不知道挂上来的是什么。

## execute

`legion/execute`，领域执行器的签名是 `run() → { cancel, done, readOutput? }`。

已经在的：

- `agent-turn.ts` 的 `startAgentTurn(request) → { result, steer, followUp }`，一次 agent 运行，轮次上限、预算裁剪、工具计数、看门狗都留在外面。
- `watchdog.ts`：流式调用静默超时就 abort 重试，provider 说是确定性失败的不重试，用户 Stop 抛 `StoppedError`。
- `observable-run.ts`：长管线共用的 subscribe/snapshot 外壳和活跃度计数。
- `limiter.ts`：整组的并发与起跑间隔，429 是让整组慢下来，不是这一次调用倒霉。
- `subagent/`：隔离上下文的子 agent 运行器。

agent-turn 两个未定点，接第一个真调用方时定：看门狗重试从原始消息重建 Agent，但轮次跨重试累加；`transformContext` 的截断不写回 Agent 的消息记录，每轮重算。

## 目录与依赖

```
legion/
  run/        run 文件的读写、状态格、租约、折叠
  mailbox/    post / read / told / ack
  presence/   每设备心跳与选举
  schedule/   FIFO、每资源串行、三种触发
  execute/    执行器契约、agent-turn、watchdog、observable-run、limiter
  subagent/   隔离上下文的子 agent
```

legion → ai、budget、platform。info、reading、memory → legion。legion 永不 import memory——memory 把蒸馏 pass 登记成 run kind，方向只有这一个。

legion 在 `tests/layering.test.ts` 的 LAYER 表里登记为 capability，上面每个新子目录都要各自登记一行。

第一个真调用方是 info 管线的一段（discover 或 fetch body）：管线各段变成 run、跑完往盒子里投递，和 Red Box 是同一件事。

## 现状

0.14.6 已落地的全是搬家和地基：`ai/subagent` → `legion/subagent`，watchdog / observable-run / limiter → `legion/execute`（纯移动，十处调用方改指，行为零变化）；pi-ai 与 pi-agent-core 升到 0.85.1；`startAgentTurn` 有测试、无调用方；LAYER 表补了 legion 三行。

未开始：run、mailbox、presence、schedule、执行器契约、ledger 折叠。

顺序：run → presence → schedule → mailbox → execute 接第一个真调用方。

## 为什么不用现成的

DeepSeek Harness 的 jobs / workflow / schedule / agent-team 全部以「一机一进程一份 session 日志」为前提，Node 运行时，iPad 的 WKWebView 里跑不了；市面的任务队列（BullMQ、Temporal、pg-boss、Inngest）都要数据库或服务端。我们的 run 跨两台设备、靠一个同步文件夹、没有服务端。所以 run 的文件格式和租约规则自己写，只借三处设计：jobs 的 `run() → { cancel, done, readOutput? }` 作执行器签名，agent-team 任务快照的 `revision` + compare-and-set 作 run 文件的合并依据，mailbox 的「先存完整消息、投递到才确认、queued 减 delivered 即待恢复」作投递语义。
