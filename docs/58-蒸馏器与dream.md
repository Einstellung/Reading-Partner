# 蒸馏器与 dream

> 2026-09-07 定案。在 [48](./48-记忆：观察与statement.md) 之上加一层，不改它的任何结论。legion 侧在 [55](./55-legion.md)。删除规则在 [50](./50-删除.md)。

---

## 定位

memory 是采集来的数据的再加工中心，legion 是 agent 的调度中心。蒸馏器由此成为 memory 的一等公民：原料进、observation 出，提取到哪写在盘上。

今天三个蒸馏器各长各的。

| 蒸馏器 | 游标 | 触发 |
|---|---|---|
| `distillThread` / `distillMarks` | `observations/meta.json`：`distilledMessages` 按 threadId、`distilledMarks` 按 bookId、节流戳 `lastDistilledAt` 和 `lastAnnotationDistillAt` 按 topicId | `arrears.ts` 从盘上算欠账，`startDistillSweeps` 每 30 分钟扫一次，另加挂断、启动、回前台、切书 |
| `distillRetell` | 自己在 `retell.ts` 里挑游标 | `useRetell.ts` 里视图卸载 |
| profile guess、dream | 各自的状态文件 | 各自的闸 |

未覆盖的源：`threads-info-<date>.json`（语音和文字伙伴的对话）、排练转写、讲稿对话。

## 契约三件

### 源登记表

一个领域登记一种原料：kind 名、怎么枚举单元（哪几个文件算一个单元）、怎么读单元里水位之后的新内容、跑哪个 pass、水位到末尾之后这个单元怎么处置（删 / 截到尾部 / 降冷层）。

memory 不 import 领域，领域在启动时登记。方向和今天 retell 把材料全部当入参传进来一致。

第一版要登记的六种：

| kind | 单元 | 水位 | 到末尾之后 |
|---|---|---|---|
| 阅读对话 | 一条线程（无页的旁支折进父线程，`arrears.ts` 的单元规则不变） | `distilledMessages[threadId]` | 不回收，UI 随时重开这场对话 |
| 划线 | 一本书的全部标记 | `distilledMarks[bookId]` | 不回收，阅读器常驻读 |
| 复述 | 一条复述线程 | `distilledMessages[threadId]` | 不回收 |
| 资讯对话 | 一天的 `threads-info-<date>.json` | 新开 | 删或并成月文件，见待定 |
| 排练转写 | 一次过一份转写 | 新开 | 降冷层 |
| 讲稿对话 | 一条讲稿线程 | 新开 | 不回收 |

落点 `memory/distill/`：`arrears.ts`、游标读写和运行器搬过去，`distill.ts` 和 `retell.ts` 留在 `observations/` 作 pass 实现。

### 水位账本

一个 API 回答两件事：单元 X 提取到哪了，它出过哪几条 observation。

水位由程序推，只在一次 pass 成功之后推到喂给模型那一段的末尾，与这趟出了几条 observation 无关，出零条也推。已蒸馏 = 有一次成功的 pass 消费过这一段。单调、可判定、没有半截状态。

水位按单元，不按 topic。`lastDistilledAt` 和 `lastAnnotationDistillAt` 那两个按 topicId 的戳是节流，不是水位，两件事不混。

存储不迁移。`observations/meta.json` 的游标表就是水位那一半；溯源新开一个追加文件，一次 pass 一行：kind、单元、区间、产出的 observation id、时间。形状稳下来再谈合并。

账本有三个读者：gc 问一个单元能不能回收；stub 问哪几条观察覆盖了被删的区间；诊断问某条观察是哪一趟 pass 从哪一段里出来的。

### pass 运行器

算欠账、过门槛、跑 pass、成了推水位、不成留在原地。门槛沿用 `arrears.ts` 的常数：`SWEEP_INTERVAL_MS` 和 `MIN_DISTILL_GAP_MS` 各 30 分钟，`MIN_NEW_MARKS` 5、`MIN_NEW_MESSAGES` 1。

运行器是一种 legion run kind：脱手，靠租约保证同一时刻只有一台设备在跑（租约是 48 里那个采集端选举的泛化），失败落进 legion 的 ledger（失败事件已带 `errorName` / `errorMessage`）。今天那个 30 分钟扫描器变成 legion/schedule 上的一条。

失败不打扰读者这条纪律不变：一条 warn、一条 `distill-failed` 事件、水位留在原地等下次重做，不弹任何 UI。

## dream 是夜班

名字不变。三阶段：

1. 付清蒸馏欠账，含没有自然关闭事件的源——`threads-info-<date>.json` 这类，读者不会"挂断"一天。
2. observation 归并成 statement，即今天 `memory/dream` 做的那一步。
3. 回收。

48 定的夜间顺序不变（修复整理 → 蒸馏欠账 → 主动检索与连接 → statement 更新 → 简报备料），回收接在末尾，5 点的简报 pipeline 不等它。48 的迁移闸同样管着这三段：观察目录里还有老布局的文件时整晚停手，回收尤其不能在那种时候动盘。

白天保留一个机会触发：单元关闭，或欠账过门槛。`memory-section` 每轮往上下文里注入未被 statement 覆盖的观察（`dropCoveredObservations`），当天就要用上的跨主题 recall 靠的是它，不能等到夜里。

dream 按同一份契约也是蒸馏器：源是 observation，产出是 statement。它的源永不参与回收，账本对它只是可观测。

## 回收：memory/gc

纯程序。逐行问账本的水位、那趟 pass 的成败和时间，加一个时钟，不读原文不调模型。

一个单元可回收，当且仅当水位到末尾、pass 成功、宽限期过了。动作由源登记表那一行给：删；截到尾部（`info-feedback.jsonl` 留 `FEEDBACK_TAIL` 那 30 行）；降到不同步的本地冷层。

同步安全：同步范围内的文件不许直接删，对端会把它原样推回来（坑 [208](./pitfall/208-file-deletion-does-not-survive-sync.md)）。两条路——走 `records` / `lines` 合并的文件加一行墓碑，就是 `deleted-observations.jsonl` 的形状；或者整文件退役走 `requestRemotePurge()`，远端删掉了才删本地。范围外的路径直接删。

代价按请求算不按字节：Drive 上一文件一请求，所以"合并成更少的文件"优先于"删掉更多的文件"。每晚给回收一个请求预算，超了等下一晚；脏比例不到阈值就整晚不扫，判据形状取自 Kafka 的 `min.cleanable.dirty.ratio`。

可解释：删掉一个单元要留一条 stub，由代码写出被删的区间和覆盖它的 observation id。

要"先进回收站再真删"的时候照抄 `sync-trash.jsonl` 的形状和它那 30 天常数，不另发明一套。

永久豁免，写在规则表之外并由测试盯着，不靠约定：`observations/`、`statements.json`、`user-profile.md`（48 的"关于人的留下"）、`saved-articles.json` 和 `article-bodies/`（读者自己收的）、各类墓碑文件。

## 边界

memory/gc 只回收已蒸馏的原料。分层上 memory 不认识 info 和 reading 的文件模式，规则由源登记表附带。

其余回收是各领域自己的 housekeeping，判据是年龄或发布状态，挂在 legion/schedule 的夜间时点上：

- info 日切缓存 `info-articles-<date>.json` 这一套，补全 `pruneStaleDailyFiles` 的触发点，重新分诊那条路径今天不触发。
- `info-pool-*` 的 TTL 已经在代码里强制执行，不动。
- 退役设备残留的 handoff 文件。
- legion 的 run 折进自己的 ledger。
- 盘点出的五处孤儿：线程配图目录、`threads-retell-<id>.json` / `threads-talk-<id>.json` 删记录时不级联、`deleteTopic` 不级联、按路径哈希命名的封面失败标记、条目级冲突副本。

共用的只有两件：platform/sync 的同步安全删除，和 legion/schedule 的那个时点。

## 候选

无限增长且蒸馏或发布之后无人再读的五类。

| 类别 | 增长形状 | 现在谁读 | 同步 | 动作 |
|---|---|---|---|---|
| `events-<topicId>.jsonl` | 逐页逐次追加，永不轮转 | 无 | 否 | 轮转或直删，platform/app 的 housekeeping |
| `threads-info-<date>.json` | 一天一份，实测 25+ 份 | UI 重开对话；蒸馏不读 | 是 | 登记为源，蒸馏后按规则回收 |
| `info-feedback.jsonl` | 追加，永不轮转 | 只读尾 30 行 | 是 | 登记为源，规则是截到 `FEEDBACK_TAIL` |
| `memory-usage-<deviceId>.jsonl` | 一设备一文件，追加 | 无（48：第一版只记不用） | 是 | 等它的消费者出现再定，memory 自己的 housekeeping |
| info 日切三件套 | 一天一份，`info-articles-<date>.json` 实测 4MB+/天 | 发布后无 | 否 | 补齐 `pruneStaleDailyFiles` 触发点，info 的 housekeeping |

`threads-info-<date>.json` 同时是私密度最高和唯一还没被蒸馏的一类，所以它是第一个登记进来的新源。

## 外部实现

只有 Claude Code 和 OpenClaw 把回收当一等功能做，Gemini CLI 2026 年才把 30 天默认打开，Codex CLI、Cursor、Aider、Cline、OpenHands、opencode 要么不回收要么只有手动删除。共识形状是四条：终态之后按年龄 TTL，默认 30 天；少量 keep-last-N 兜底；扫描在启动时跑一次不设常驻定时器；硬删无墓碑。没有任何一家用"已被蒸馏"当判据——Claude Code 离得最近，但它的动作是反的，保护蒸馏产物不被删，而不是拿蒸馏完成度去授权删原文。我们要自己解决的三件别人没有：双副本删除不能复活（对口文献只有 CRDT 墓碑和 IMAP QRESYNC）、代价按 API 请求计价、删除可解释。

## 待定

- 读者会不会回看 `threads-info-<date>.json` 的历史。会，就不是删而是并成月文件。
- 删原料还是留一份本地不同步的冷层。倾向冷层：花的是磁盘不是请求，而且蒸馏器会变好，今天抽不出来的东西将来重读还能抽。
- 语音原始音频是否只留在录制的那台设备上。是的话它的删除退化成单副本问题，同步安全那一整块都省掉。
- 账本一行存什么。
- dream 的目录将来要不要把白天那个运行器也收进去。
- 从未被任何 statement 引用的观察退出候选池的 K。48 的开放点，此处不动。
