# info 收藏与 reading 打通

> 本文记录"info 侧的材料怎么进 reading"的共识，是 [16](./16-知识图谱.md)、[17](./17-信息源系统.md) 的下游；落法依赖 [13](./13-账户同步.md) 的三方合并模型和 [02](./02-AI核心与memory设计.md) 的记忆设计。文中的现状按 2026-07-27 的代码查证。

> 落地状态（2026-07-30）：收下的存储已落地。`saved-articles.json`（`src/reading/saved-articles.ts`）在同步范围里（`src/platform/sync/syncFs.ts`），也登记进了合并契约的 `RECORD_FILES`（`src/platform/sync/merge/contract.ts`）。内容寻址的快照通道还没有：正文快照现在直接躺在记录里（`SavedArticle` 的 `text` / `html`）。

---

## 原则

不把 info 做成第二个书库。书是挑的、读几小时、会回来；文章是撞上来的、读几分钟、绝大多数只值得读一次。把文章当小书存起来就是 read-later，最后变成坟场。

保存的产物不是文章，是文章对你的意义：当场归题、抽出它加了什么、跟已读的是印证还是冲突。正文留快照，身份是引用证据，不是等你回来读的材料。

重心在 reading。topic 是引力中心，info 是补给线，不是反过来。

不引入第三套状态机。info 侧现有的 `opened` / `dismissed` / `appealed`（`src/observation/feedback.ts` 的 `FeedbackAction`）只喂 info 自己的筛选，一条都不进 reading，这条边界写死在代码里。收藏只有一个动作：收下。其余状态都是推导的。

## 入口

只有用户的主动行为能让 info 材料进入 reading。两个入口：文章页上的 Keep 按钮（`src/ui/components/info/ArticleView.tsx`，接线在 `InfoHome.tsx`），以及在聊天里说"这篇存一下"。AI 只能执行，不能自己决定存什么。

Keep 的语义是"这条要进我的阅读上下文"，不是喜欢、不是稍后读。图标和文案不能长得像收藏夹。

briefing 卡片今天只有三个手势：打开、×（dismiss）、滤掉区的 Show anyway（`src/ui/components/info/BriefingPage.tsx`），没有任何星标或收藏入口。reading 侧已有的 `starred` 是批注上的标记（`src/reading/engine/convert.ts`），跟这件事无关，但名字会撞。

## 保存那一刻发生什么

收下一条，同时发生三件事：正文快照落盘、AI 当场提议归属和意义、一张确认卡等用户点头。

AI 提议的不只是 topic，还有这条材料对这个 topic 加了什么、跟已读的是印证还是冲突。这段判断和 topic 提议一起进确认卡，用户点头才落。

确认卡的机制现成，`update_profile` 走的就是这条路：工具只起草并推一张卡，UI 的 Apply 才写盘（`src/info/companion/companion-tools.ts` → `src/info/briefing/cards.ts` → `InfoCards.tsx` → `InfoCall.tsx` 的 `handleApplyProfile`）。收藏沿用同一形状。

## 归属与默认 topic

保存时不让用户选 topic。AI 当场提议（现有的，或提议新建），一键确认。

分类不了的进默认 topic。默认 topic 是队列不是货架，要被预期清空；根上的 AI 持续提议把里面的东西并进真 topic，只提议，用户点头才动。它长期只增不减时，系统要自己说出来。

## 两个根

info 和 reading 各有一个根聊天。新收下的材料浮现在 reading 的根，不进具体的书里——读书时人在深处，往里塞"外面有什么新的"是打断。

不做"一点开就播报"。变化本身待在环境里（哪个 topic 多了几条，扫一眼就知道），聊天只在被问时展开。

两个根从第一天起共用同一份记忆和同一份画像。分两份的话，将来那个跨两侧的管家一来就是一次迁移。

未来的管家是一个跨两边的声音加一份共同记忆，不是把两个屏幕并成一个。扫和沉浸是两种姿势。这个拓扑不是过渡态。

## 四条补充

纠错在对话里做，不为它加界面元素。归错了就跟 AI 说一声改掉。取消收下是真的移除，不是归档。

抓不到正文是常态不是异常（付费墙、要 JS 的站、公众号）。"证据不全"是一等状态：引用时明说原文没拿到，不能让 AI 拿摘要当原文讲。`InfoItem.summaryOnly` 已经是一等字段，triage 的 prompt 标 `[summary only]` 并禁止装作读过（`src/info/briefing/triage.ts`），缺的是这个标记跟着材料进 reading。

时效跟着走。发表时间必须存下来，引用时必须带上，否则三个月前的"最新进展"会被讲成新闻。`publishedAt` 在 `InfoItem` 和 `BriefingItemMeta` 上都已存下，引用路径上没有。

AI 这次用了哪几条外部材料，用户要看得见。可见性是闸的一部分。

## 数据与同步的落法

收下的记录是一份新的 records 文件，不复用 `info-feedback.jsonl`。那个日志专供 triage 的 prompt 尾巴（`formatFeedbackTail` 取尾 30 条），`FeedbackAction` 是封闭三值；往里加第四个值就是把收藏喂回 info 的筛选，正是原则里要断的那条边。

正文快照按内容寻址存成不可变 blob，像书那样只传一次，不进每次同步都参与合并的记录文件。记录文件里只留快照 hash、URL、标题、来源、发表时间、`summaryOnly` 和归属。

同步范围（`src/platform/sync/syncFs.ts`）现在的分界：`user-profile.md`、`info-sources.json`、`info-feedback.jsonl` 在范围内，`threads-*.json` 通配匹配所以 `threads-info-<date>.json` 也在；`briefing-<date>.json`、`info-articles-<date>.json`、`info-items-<date>.json`、`info-source-health.json` 都是派生的，不同步。收下的记录要进范围，快照走 blob 通道。

新记录文件要在两处登记：`strategyFor` 的 `RECORD_FILES`（`src/platform/sync/merge/contract.ts`）和 `recordShape`（`merge/records.ts`）。不登记就掉进 opaque——保我的、把对方的停在旁边——两台设备各收各的会一直丢一半。

## 现在缺什么

按依赖排。

- 收下的存储。一份新的 records 文件（进同步范围 + 两处合并登记），加一条内容寻址的正文快照通道。现在的 blob 通道只认书：接口方法叫 `hasBook` / `uploadBook` / `downloadBook`，Drive 侧写死 `books/` 文件夹和 `.pdf` 后缀（`src/platform/sync/driveBackend.ts`），驱动它的是 `library.json` 的 hash 列表。要么泛化成按 kind 分文件夹的 blob 通道，要么另开一条。

- Topic 装得下文章。`Topic = { id, name, createdAt, files: FileRef[] }`，`FileRef` 的身份是本地 PDF 路径，`hash` 是打开时回填的书 id，下游全按 hash 读 `reading-state` / `fulltext` / `annotations`；UI 只有一个 "Add PDF" 按钮，`addFileToTopic` 只有文件选择器一个调用者。文章没有 path、没有页码、没有批注，塞进 `files` 会污染整条链路——要给 topic 加一类成员，不是往 `FileRef` 上挂可选字段。默认 topic 已经有了：固定 id 的 Brief topic，首次收下时创建，按 id 幂等（`ensureBriefTopic`，`src/platform/app/topics.ts`）；清空还要新加。prep 抓来的论文是同一个坑的既有案例，它至今没进 topic，住在 `prep-<bookHash>/` 里。

- 保存那一刻的编排。工具形状现成（`AgentTool`：name / description / TypeBox schema / execute），`src/ai/` 只有机器、零领域工具，收藏工具属于领域。卡片这边三处要动：联合类型 `CardPayload = InfoCard` 指向 `src/info/briefing/cards.ts`，收藏卡是 reading 的概念，联合要拆成两半；`isPersistableCardKind` 的白名单要加一项；reading 侧的聊天还在老字段上（`messageToParts` 兼容），卡片协议对它可用但一张 reading 侧的卡都还没有。工具名要避开 `add_source`——info 的"订阅源"和 prep 的"摄入 URL"已经各占一次。

  分层上这件事落在 reading：材料进的是 reading 的上下文，编排代码放 `src/reading/` 下。今天 `info` 和 `reading` 之间一条 import 都没有；星标在 info 的卡片上、写路径在 reading，由 `App.tsx` 接线就不必新增领域边，聊天里的保存工具由 `ui/components/info` 装配（ui 可以 import 任何领域）。另外 `info` 在 `tests/layering.test.ts` 的 LAYER 表里是单个节点，它的四个子目录之间已经有环，短期内别想把 info 升成分组目录。

- reading 的根聊天。现在没有。所有阅读对话都在 `threads-<bookId>.json` 里，只能从打开的书里进（划线气泡、标记列表、顶栏 AI 按钮的书级 thread）；`LibraryScreen` 一个聊天入口都没有。要新加一个不属于任何书的 thread key 和一个进得去的屏，新收下的材料在那儿浮现。

- info 的根聊天跨天。现在按天分文件：`infoBookId(date)` 返回 `info-<date>`，落成 `threads-info-<date>.json`，thread id 只有 `briefing` / `onboarding` / itemId 三种（`src/info/companion/call.ts`、`InfoCall.tsx`）。"info 有一个根聊天"要一个跨天不变的 key，否则每天换一个根。

- 共用的记忆作用域。AI observations 只有按 topic 一种形态：`ObservationFileStore` 的构造参数就是 topicId，目录是 `memory-<topicId>/`（历史名）。info 侧一条观察也不写，只读画像和反馈日志。跨场景共用的今天只有 `user-profile.md` 一份文件。两个根共用记忆要一个不属于任何 topic 的记忆作用域，且从第一天就是它——先按 topic 建再合并就是那次要避免的迁移。

- 引用时的三件事。时效（`publishedAt` 已存，要进引用路径）、证据不全（`summaryOnly` 已存，要跟着材料进 reading 的 prompt）、用了哪几条材料的可见性。第三条现在没有落点：工具痕迹是瞬时的，成功即从行里消失，从不落盘（`src/ai/tool-status.ts`）。可见性既然是闸的一部分，就不能靠一个成功就消失的东西。

反向的边已经有一条：`assembleReadingContext()` 把各 topic 的 observation 索引拼成一段 READER'S CURRENT CONTEXT 喂给 triage（`src/observation/assemble.ts` → `src/info/briefing/live.ts`）。reading→info 通了，info→reading 一条都没有。

*讨论：2026-07-27*
