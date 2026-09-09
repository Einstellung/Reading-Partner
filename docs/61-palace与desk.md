# palace 与 desk

> 2026-09-08 定案。上游：[48](./48-记忆：观察与statement.md) 是观察与 statement 两个仓，[55](./55-legion.md) 是 run 与调度，[58](./58-蒸馏器与dream.md) 是蒸馏与回收，[59](./59-同步：持有清单与裁决.md) 是同步与合并，[60](./60-info：白宫与Red Boxes.md) 是盒子与秘书，[21](./21-info收藏与reading打通.md) 是收藏的落法，[45](./45-陪伴的形态.md) 是桌宠的形态。
>
> 取代关系：2026-07-26 定的「先 info 成熟、再联动、最后提 partner」作废，贯通先做，它是地基。60 待定节的「视野落在哪」定为 topic。原计划在「记忆更新」那一场产出的「按数据类别的总表」不做，改成按「挂在 palace 的哪个实体上」组织，就是本文；60 留给那一场的三问和 58 的回收待定项照旧，转记在本文待定节。

---

## 问题

reading 的 AI 和 info 的 AI 互不认识。

info 的 AI 不读任何 statement 和观察，只读 `user-profile.md` 的 declared 半段，而 reading 已明确停读该文件（48）。info 的对话 `threads-info-<date>.json` 没有任何蒸馏器读，它的线程 id 当初专门做成全局唯一就是为了锚点（`anchors.ts:23-27`），至今无人用。info 侧没有 topic：`grep topicId src/info` 为零，收藏是唯一带 topic 的 info 对象，值写死 `BRIEF_TOPIC_ID = "brief"`。跨域读只有一条边，reading 能列收藏文章；reading 的记忆只以批处理 prompt 的形式进 triage（`briefing/live.ts:565`），info 看不见书、划线、阅读位置。五个 AI 入口五份手拼的工具数组和 prompt，没有注册表，两个同名不同义的 `add_source`（`info/sources/source-tools.ts`、`reading/prep/papers/source-tool.ts`）。对话按书 / 日期 / retell / outline 四种键分开，唯一的跨线程读是同一本书内（`turn.ts:890`）。

数据层同形。一个文件的身份散在五张互不核对的手写表里：`syncFs.inSyncRange`、`NEVER_INFER_DELETE`、`merge/contract.strategyFor` 加 `RECORD_FILES`、`reading/delete` 的 dead-paths、`memory/observations/arrears.ts`。引用全是裸字符串，没有仓库也没有 schema。`deleteTopic` 只摘一行（`topics.ts:232`），retell、rehearsal、观察、收藏的 topicId 永久悬空。书名在 library、retell.types、topics 的 `FileRef` 三处各存一份，靠 `material.ts:85` 的 fallback 链凑。

`src/ai` 已经是两边共用的 capability，所以「做成共用能力」不是答案。让 AI 成为一个的是共用的记忆、对话史、世界图和工具集；调用路径共用了，这四样各自私有，就是今天的样子。

目标是一个 AI：用户不关心它在哪，和它聊它就能去做各种事。今天它长出 reading 和 info 两种样子，将来还会有第三种，桌宠也是它。

## 五个名词

**palace**（`src/palace/`）是一等公民，AI 工作和生活的那座房子，回答「有什么、在哪、指向谁」。一个 id 空间，每种数据在里面有一行，写明它在宫里的位置和它引用哪些别的数据。今天散在五张手写表里的东西——同不同步、怎么合并、删书连带删什么、蒸馏从哪读、回收怎么处置——全部从这张表推出来，一个守卫测试盯着，做法同 `tests/layering.test.ts` 的 LAYER 表。不改文件布局：一文件一记录是 59 同步模型的前提，贯通做在读取面和 id 空间上。没登记的东西在它眼里就是不该存在的，今天的孤儿是 `images/threads/`、旧 `talk-*.json`、`slides/**` 和按路径哈希键的封面失败标记。名字取自白宫本来就是一座宫，60 那套词直接落在里面。不叫记忆宫殿：`src/memory/` 已经是名字，memory 是住在宫里的东西不是宫；保留的是「每样东西有固定位置所以找得到」这一半。不叫图书馆：它描述的是「所有能找到的东西」而不是「AI 此刻面对什么」，而且 library 已经被 `library.json` 和 59 的 holdings 占着。

**desk** 回答「AI 此刻面对什么」，登记的是「什么能上桌」：书、cable、收藏的文章、讲稿大纲、排练转写，将来任何东西。每种上桌的东西带两样：摊开后能看见什么（上下文），能对它做什么（工具）。桌上可以同时摆几样——今天 reading 的 AI 能列收藏文章，就是书旁边放了一篇文章。空桌也是一种状态，就是桌宠。desk 小是对的，它的上限是一个上下文窗口；扩展性在于能上桌的种类无限制。阅读器底色 token 在 `styles.css` 里已经叫 `--desk`。落点 `src/desk/`，capability 层——palace 在它下面一层，装配要读领域登记上来的上下文和工具，进不了 platform。

**AI** 是坐在桌前的人，只有一个，装配留在 `src/ai/`。每次开口是一次装配：脑子里的东西（48 消费侧那三块）+ 桌上的东西 + 桌上东西带来的工具。它不认识书也不认识盒子，只认「上桌的东西」这个抽象。reading 是桌上有书，info 是桌上有盒子，桌宠是空桌，第三种形态是再登记一种能上桌的东西。60 的秘书长是桌上有盒子时这个人的样子，不是另一个 agent：它的三种模式、游标、tasking 工具全部来自桌上那个盒子的登记，记忆、对话史、世界图和别的情境完全一样。照 60 的字面在 `info/` 里再起一份 prompt 加工具数组加线程键，就是第三个 AI，禁止。

**memory** 是这个人的脑子，48 和 58 一条不改。观察和 statement 作为数据登记在 palace 里，语义上归这个人，去哪张桌都带着。它消费 palace 两件事：蒸馏源（哪些登记过的数据是原料，即 58 的源登记表成为 palace 登记的一节），和锚点解析（一个 id 指的东西还在不在、内容是什么）。

**legion** 是派出去的人。一个 run 是没有 UI 的一次装配，坐同一张桌、用同一个脑子。它是 palace 的第三个写入方，写入走 59 的裁决和 harness 的闸：起草自由，落地设闸。

palace 不吞装配。宫是静的，人是动的；palace 只回答「有什么、在哪、指向谁」。

## 登记

一种数据在 palace 有一行。那一行是纯数据：路径模式、所属领域、id 键、引用哪些别的 kind、合并策略、删除级联、回收动作、是不是蒸馏源。表由 palace 自己持有，不需要领域在运行时登记。

运行时登记的是另外两件，各按 kind 名挂到那一行上：能上桌的东西登记进 desk（上下文加工具），蒸馏源的读法登记进 memory（58 的源登记表）。

五张手写表改成派生。同不同步、合并策略、删书的连带、蒸馏源、回收动作，全部从那张表读出来，守卫测试盯住「登记了但没派生」和「盘上有但没登记」两边。

分层：palace 在 LAYER 表里是 platform 层，目录仍是 `src/palace/`——`platform/sync` 只能 import platform，而同步范围、合并策略、dead-paths 要从 palace 派生。desk 是 capability，不 import 任何领域；领域启动时登记，方向和 58 一致（memory 不 import 领域，领域登记）。新目录登记进 `tests/layering.test.ts` 的 LAYER 表。

## 定下的

跨桌的原始对话可以直接检索，不必只经观察锚点绕回去。范围先按 topic，topic 内没命中再扩大。这次不复杂化，检索以后会重做。

视野就是 topic，一个实体，不是 statement 的一种也不是 info 自己的配置。cable 在 `saved` / `promoted` / `folded` 三个出口带 topic，由 AI 提议、用户点头，形状是 21 已定的那张确认卡。`BRIEF_TOPIC_ID = "brief"` 是应急版。

顺序上先 desk 后 topic 进 info。

## 顺序

1. palace 登记表落地，五张表改成派生，守卫测试上。纯搬运，不改行为。
2. info 接记忆：读 statement 和观察，`threads-info-<date>.json` 进蒸馏源（58 已把它列为第一个新源）。
3. desk 登记表加装配，五个 AI 入口收成上桌的登记。
4. topic 进 info 侧。
5. 跨键的对话读法，范围规则见上节。
6. Red Box 和 cable 作为第一个生在 palace 里的新东西落地，不再另起私有存储。

## 待定

从 60 转来的三问已在 [63](./63-情报局：研究室、专项组与态势.md) 定案：打断算 `asked`；不要 `later`；过期按同研究室的新盒取代。

从 58 转来的三问：读者会不会回看 `threads-info-<date>.json` 的历史，会就不是删而是并成月文件；删原料还是留一份本地不同步的冷层；账本一行存什么。

稿的聚合触发：定时、够料了、还是用户开口（60 遗留）。
