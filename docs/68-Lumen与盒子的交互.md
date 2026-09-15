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

## 盒

盒泛化，不再是 info 私有。一个盒是一个 batch，一项是一条 cable 或一个 run 的产出。研究 run 就是一盒一项；`local` 档的 run 不带 `batchId`，`boxId` 取 run 的 id。

文件形态沿用 60：一项一个文件，生在 palace 里，随账户同步；封面写一次不改；状态在项自己那份文件上，没有第二个可变文件。状态表也沿用 60 那张：`in box` / `told` / `asked` / `dismissed` / `saved` / `promoted` / `folded` / `aggregated`。跳转到原地就是 `told`，摁掉就是 `dismissed`。

代码在 capability `src/box/`。

项的字段：

| 字段 | 含义 |
|---|---|
| `id` | 全局唯一，即文件名 |
| `boxId` | 所属的盒 |
| `source` | `run` 或 `cable` |
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

Lumen 全局常驻：每个外壳每个地方的右下角都有，72 px，就是今天 info 简报角上的那个位置。门那一层放大的不变。

点左上角的 Reading Partner logo 切换它出现或消失，按设备记住。消失时盒子照样攒，只是不显示。

看书时它静止：不呼吸不摇。唯一会变的是盒子到了那一下，换成「抱着盒子」的姿势，换完继续静止。

数字徽标在 Lumen 右上角，数字是没开的项数。抱盒子的姿势不承载数字。

点 Lumen 从角上向上展开一列卡片，最多露五张，多了在列内滑。每张一句封面加来源（哪本书哪页，或 info 哪个研究室）。点一张跳到原地——是书就开那本书、翻到那页、开那条线程，跨书先开书——并记 `told`；横划摁掉记 `dismissed`。浮层走 `ui/overlay.tsx` 的规矩（[30](./30-shadcn迁移.md)）。

原来点角上 Lumen 开 info 语音的入口先屏蔽，将来做成这一列最底下的一项。

## soul 知道盒里有什么

每个 soul 回合的系统提示带上没开的项的封面清单，一项一行。相关时 soul 提一句：「你在 37 页问的那篇文献查回来了」。

## 第一个应用

reading 的文献研究。reading 域登记 kind `research-literature`，agent worker，`local` 层（进程内，不落文件，在读者所在设备上跑），身体就是今天的研究子 agent（`src/reading/papers/research-agent.ts`）。

阅读回合不再挂 `research_literature` 子 agent 工具。soul 有一个通用 `delegate` 工具加一份 kind 目录，自己决定：简单的当场答（`find_paper` 留在回合里），重的派 run，回合立刻结束。

这是 55 的第 10 步 translate 之前插进来的第一个调用方，translate 往后排。

info 的盒（60、63）等 Red Boxes 落地时用同一个 `src/box/`，简报页现状不动。

## 顺序

1. 盒生在 palace：`src/box/` 的项与盒、palace 登记行、状态迁移。验收：两台设备各写一项，合并后两项都在，状态按项自己那份文件收敛。
2. Lumen 全局化：每个外壳右下角常驻，logo 开关按设备记住，看书时静止，徽标数没开的项，点开是那一列卡片，点一张跳回原地。验收：在书里派一个 run，回来后角上出现抱盒子的姿势和徽标 1，点进去点那张卡回到原页原线程，项变 `told`。
3. research run：kind `research-literature` 登记、`deliverTo` 投回线程、soul 的 `delegate` 工具加 kind 目录。验收：阅读回合里派一个文献研究，回合立刻结束，结果回来追加进那条划线线程，同时盒里多一项。
