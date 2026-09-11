# soul

> 2026-09-11 定案。上游：[61](./61-palace与desk.md) 是 palace 与 desk，[48](./48-记忆：观察与statement.md) 是观察与 statement，[58](./58-蒸馏器与dream.md) 是蒸馏与回收，[21](./21-info收藏与reading打通.md) 是确认卡的形状，[45](./45-陪伴的形态.md) 是形态的证据与法律边界，[66](./66-Lumen.md) 是空桌前的那个样子，[63](./63-情报局：研究室、专项组与态势.md) 是研究室与分析员，[55](./55-legion.md) 是 run 与调度。
>
> 取代关系：[61](./61-palace与desk.md) 的「五个名词」一节由本文重写——AI 这个名字作废，改叫 soul，palace、desk、memory、legion 四条不变，措辞跟着改；61 的「顺序」一节作废，按本文末节。61 的「登记」「定下的」「待定」三节照旧。

---

## 名字

坐在桌前的那个人叫 soul，AI 太泛。`src/soul/` 是它，一个 capability；`src/ai/` 只剩接线：provider、OAuth、模型调用。`soul/self.ts` 是每次开口都带的那部分——关于读者的 statement，和写它的工具；`soul/turn.ts` 是把这个人和摊开的桌子拼成一次调用。soul 面对桌子，不持有桌子。

soul 是一等公民。常驻的那个面对用户，legion 派出去的是同一个 soul 的更多实例，记忆只有一份，共用。legion 的 soul 写记忆走和常驻那个一样的路，没有特例。

## 进门就是它

打开 app 就是见到 soul。去阅读就装上阅读的能力（桌上有书），去 info 就装上 info 的（桌上有盒子）。要不要显示一个形象（球，将来是 [66](./66-Lumen.md) 的 Lumen）是显示开关，不是模式。

否掉的：把空桌当成第七种形态（桌宠）。形态只有一个，就是 soul。

第一屏长什么样、怎么交互，待议。主动开口这次不做。

## 角色

角色是 soul 装上去的东西，登记进 soul，做法同能上桌的种类登记进 desk。一个角色只带三样：一段职责、一份工具清单、一道写入闸。没有私有数据，没有私有记忆。

[60](./60-info：白宫与Red Boxes.md) 的秘书长是 soul 装上秘书角色、桌上有盒子。[63](./63-情报局：研究室、专项组与态势.md) 的分析员是 soul 装上分析员角色、桌上有研究室。登记表在 `soul/roles.ts`；秘书已登记（`info/briefer/role.ts`），职责段和加源、读页、派研究室那些工具从简报桌项上抬到了角色里，写入闸按 card / trial / instruction 三种声明。分析员今天没有独立的职责段和工具，还没登记。

## places

一张表，外壳登记进 desk，每个 place 一句话说明它是干什么的，外加一个 `go()`。soul 拿到一个 `go_to` 工具，它去哪里，桌上就换成什么。

这取代新手引导浮层：soul 带着读者转一圈，之后任何时候都能再介绍一遍。登记表在 `desk/places.ts`，壳注册 today、briefing、topics、sources、settings（手机壳没有书架），一句话写在 `go_to` 的工具描述里，不进 prompt。

## topic 不是 soul 的

2026-09-11 推翻 09-10 的「提 topic 是 soul 的事」。soul 比 topic 高一层，不能被 topic 圈住。

topic 是数据侧的归档键：一本书列在哪个 topic 下（一本书总在某一个里，导入经由当前 topic），一篇文章收在哪个 topic 里，一条观察记在哪个 topic 名下。soul 每次开口把全部记忆都带上；桌上那样东西的 topic 只决定先看哪里。

把一段对话归到某个 topic 是一个记忆工具。确认卡的形状仍是 [21](./21-info收藏与reading打通.md) 那张：soul 提议，读者点头，然后整段对话都算那个 topic（`soul/topic/propose.ts` 提议，`settle.ts` 落笔）。`BRIEF_TOPIC_ID` 不再是对话的兜底，只剩收藏文章的队列。

记忆和检索将来要重做，soul 这一侧的记忆到那时再系统地设计；今天这份是最小形状。

## 对话按归属存

一本书的对话在书的文件里，info 的按天，retell 的在自己那份。在门口说的话（桌上没东西）有自己的 palace kind `conversation`，一天一个文件，`conversation-<date>.json`；key 到文件名的对应是线程库里的一张表，palace 的守卫测试盯着它和登记行一致。删一本书不该去翻日期文件；就着划线问的那一句属于这本书。

连续性是派生的时间索引 sequence（`src/soul/sequence.ts`）：每个文件的每条线程切成一段 span，按时间排。它是本地缓存，登记在 palace 里，丢了重建，实测 36 个文件 1.3 MB 679 条消息冷建 14 ms。

回放两段：soul 的尾（跨 place 最近说过的话）加条目自己的 span，合计 40 条，条目那段优先。尾是预算梯上自己的一级，最先掉。

thread 是旧名字，概念是 conversation 和 span，存储里的标识符还没改名。

没归 topic 的对话不蒸馏；读者点头之后整段都算。攒够数据再决定这堆没 topic 的对话要不要别的处置。

## 顺序

做完的：palace 登记表加派生（61 第 1 步）、desk 登记表加那一次装配（第 3 步）、info 接记忆（第 2 步）、topic 确认卡（第 4 步，现在归记忆）、门口对话加 sequence 加双段回放（第 5 步）。

2026-09-11 又做完的：登记表的工具（`soul/catalogue.ts`，`list_palace` 和 `list_kind`）、places 和 `go_to`、秘书角色登记进 soul、语音从 `info/briefer` 搬到 `soul/voice`（`voice-call-live.ts` 是 info 桌的接线，留在 info）。

接着：

1. 第一屏的交互，待议。
2. 存储标识符从 thread 改名 conversation。
3. Red Box 和 cable 作为第一个生在 palace 里的新东西落地，不再另起私有存储（61 第 6 步）。
4. 记忆与检索重做。
