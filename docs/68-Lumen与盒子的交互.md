# Lumen 与盒子的交互

> 2026-09-15 定案。上游：[55](./55-legion.md) 是 run、bell 与调度，[60](./60-info：白宫与Red Boxes.md) 是盒子、秘书处与状态表，[63](./63-情报局：研究室、专项组与态势.md) 是研究室与 tasking，[66](./66-Lumen.md) 是形象，[67](./67-soul.md) 是坐在桌前的那个人，[61](./61-palace与desk.md) 是 palace 登记。
>
> 取代关系：本文修订 [66](./66-Lumen.md) 的「位置与尺寸」（Lumen 全局常驻，看书时静止），并把它待定里的「reading 侧的聊天入口要不要也露 Lumen 的脸」定掉。[60](./60-info：白宫与Red Boxes.md) 的盒子一节由本文泛化——盒不再是 info 私有，状态表和文件形态不动。

---

legion 的底座（run、claim、schedule、runner、bell、ledger，55 第 1 到 9 步）已经在 main 上，上面没有交互：一个 run 跑完，结果放哪、用户怎么知道、怎么看，三件都没有答案。本文定这一层。

## 不推送与回原地

run 完成不打断用户，不弹窗、不红点、不进任何系统通知。60 的推论 4 照旧。

回复写回提问的地方。run 带 `deliverTo`，记的是它从哪儿派出来的：某本书的某条线程（划线线程带 annotationId，也可能是书的总线程），或门口。铃响时 soul 的答铃回合按那个地方装配——是书就按阅读桌装配，桌上有那本书；是门口就按门口装配——然后把回复追加进那条对话。用户下次翻回那页、点开那条划线，答案就在那里。

答完之后由程序层（60 的 Staff Secretary，不用模型）往 Red Box 里放一项，指回那条对话。失败或拿不准的 run 放进去时标「要你定」，这一类 soul 可以在门口主动说一句；其余沉默。

用户自己问的那一轮同理。turn 发出去之后只有停止按钮和删除线程能掐断它，关掉聊天、点书页、合上书、退出阅读器都不打断（docs/03）。回答落地时那条线程不在屏幕上——视图关了、开着别的线程、或者人已经离开这本书——就放一项：`source` 取 `turn`，`boxId` 取线程 id 加时间戳，封面是回答第一句（和铃那边同一个 `coverOf`），`origin` 指回书和线程，摁一下跳回去。落地时人正看着这条线程就不放。这一轮失败了又没人看见，放一项标「要你定」，封面是错误本身——线程里什么都没留下，这项是它唯一的痕迹。

## 盒

盒泛化，不再是 info 私有。一个盒是一个 batch，一项是一条 cable 或一个 run 的产出。研究 run 就是一盒一项；`local` 档的 run 不带 `batchId`，`boxId` 取 run 的 id。

文件形态沿用 60：一项一个文件，生在 palace 里，随账户同步；封面写一次不改；状态在项自己那份文件上，没有第二个可变文件。状态表也沿用 60 那张：`in box` / `told` / `asked` / `dismissed` / `saved` / `promoted` / `folded` / `aggregated`。跳转到原地就是 `told`，摁掉就是 `dismissed`。

代码在 capability `src/box/`。

项的字段：

| 字段 | 含义 |
|---|---|
| `id` | 全局唯一，即文件名 |
| `boxId` | 所属的盒 |
| `source` | `run`、`cable` 或 `turn` |
| `cover` | 封面一句 |
| `body` | 正文引用，run 的就是它的 `output` |
| `origin` | 书 + 线程 + 划线，或门口某天，或简报某天 |
| `kind` | run 的 kind，或 cable 的类别 |
| `runId` | 来自 run 时有 |
| `needsDecision` | 要你定 |
| `createdAt` | |
| `state` | 上面那张表 |
| `stateAt` | |

## Lumen 作为入口

Lumen 全局常驻：每个外壳每个地方的右下角都有，72 px，就是今天 info 简报角上的那个位置。门那一层放大的不变。全窗聊天里输入条占着下边缘，角就抬到输入条上面——按输入条量出来的盒子抬（含安全区），不是估一个高度；卡片列还是从角上往上开。只有按住说话的那一下让开：落点面板铺满输入条宽度，右边那个「Edit」正压在角下面。

盒子是角上独立的一层，不在 Lumen 手里：一个竖放的红色公文盒（英国大臣的 dispatch box 那种，红色哑光皮面、盒盖在上、正中一个铜扣，没有花押也没有文字；柔光 2.5D 和 Lumen 一致，但它自己不发光），站在 Lumen 左边、同一个光池里，和身体一起生成再抠出来（`docs/assets/lumen/lumen-with-case.png`），比例照那张图量：72 px 的角上盒子约 24×25 px，是圆身子（约 45×44 px）的六成高，右边缘压在身体左侧轮廓里，两个底边齐平，盒子左边探出身体方框约 5 px。只在有没开的项时出现，空了就消失，角上只剩 Lumen。手机宽度上 72 加 40 加间距不到 130 px。Lumen 的身体位图和 SVG 眼嘴不为盒子改动。

点左上角的 Reading Partner logo 切换它出现或消失，按设备记住。关掉时盒子一起关，项照攒。

看书时它静止：不呼吸不摇。盒子到了那一下 Lumen 有一次反应：眼睛往盒子那边瞟一下再看回来，用的是「查」那段的眼睛动作，一次性的，不是持续动画；看书时也成立。

数字徽标 16 px，骑在盒子左上角（外侧那个角），用现有的墨绿徽标样式，数的是没开的项数。不放右上角：盒子压在身体左下，顶边齐到眼睛，右上角的徽标正好盖住 Lumen 的左眼。

点盒子从角上向上展开一列卡片，最多露五张，多了在列内滑。每张一句封面加来源（哪本书哪页，或 info 哪个研究室）。点一张跳到原地——是书就开那本书、翻到那页、开那条线程，跨书先开书——并记 `told`；横划摁掉记 `dismissed`。浮层走 `ui/overlay.tsx` 的规矩（[30](./30-shadcn迁移.md)）。

点 Lumen 留给将来的语音入口；原来点角上 Lumen 开 info 语音的入口先屏蔽。

## soul 知道盒里有什么

每个 soul 回合的系统提示带上没开的项的封面清单，一项一行。相关时 soul 提一句：「你在 37 页问的那篇文献查回来了」。

## 第一个应用

reading 的文献研究。reading 域登记 kind `research-literature`，agent worker，`local` 层（进程内，不落文件，在读者所在设备上跑），身体就是今天的研究子 agent（`src/reading/papers/research-agent.ts`）。

阅读回合不再挂 `research_literature` 子 agent 工具。soul 有一个通用 `delegate` 工具加一份 kind 目录，自己决定：简单的当场答（`find_paper` 留在回合里），重的派 run，回合立刻结束。

这是 55 的第 10 步 translate 之前插进来的第一个调用方，translate 往后排。

info 的盒（60、63）等 Red Boxes 落地时用同一个 `src/box/`，简报页现状不动。

## 顺序

1. 盒生在 palace：`src/box/` 的项与盒、palace 登记行、状态迁移。验收：两台设备各写一项，合并后两项都在，状态按项自己那份文件收敛。
2. Lumen 全局化：每个外壳右下角常驻，logo 开关按设备记住，看书时静止，徽标数没开的项，点开是那一列卡片，点一张跳回原地。验收：在书里派一个 run，回来后角上出现红盒和徽标 1，点进去点那张卡回到原页原线程，项变 `told`。
3. research run：kind `research-literature` 登记、`deliverTo` 投回线程、soul 的 `delegate` 工具加 kind 目录。验收：阅读回合里派一个文献研究，回合立刻结束，结果回来追加进那条划线线程，同时盒里多一项。

三片 2026-09-15 都已进 main。实现时定的几条：

- `delegate` 每个 soul 回合都挂，不看本机有没有登记 kind；kind 清单写在参数说明里，错的 kind 调用时拒绝（坑 313）。
- `local` 档的 run 在 runner 之外读不到，所以 `run-done` / `run-failed` 铃的 payload 自带 `deliverTo`，答铃先读 payload，再退到 run 文件。
- 任务书写在 `legion/briefs/<uuid>.md`，产出写在 `legion/outputs/<runId>.md`，都是本地文件，palace 行 `run-brief` / `run-output`。
- 答铃按地方装配走 `soul/delivery.ts` 的登记表（place → opener），reading 在 `reading/deliver.ts` 登记 `book`；简报页还没传 origin，从简报派的 run 暂时在门口答。
- 阅读聊天里不再显示子 agent 的进度行，进度走 run 的 `progress`。
- 门口和简报的卡片带日期但页面只画当天，跳转只选页面不选日子。鼠标设备用悬停出现的叉代替横划。
