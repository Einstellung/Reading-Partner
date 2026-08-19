# 读到 slides 这条路的现状

> "开一本书或一篇论文，读它，出一份 slides" 这条路今天实际停在哪里。上游是 [14](./14-笔记与PPT.md)（笔记与 PPT 的设计共识）和 [09](./09-学习机模式.md)（备课管线）。缺陷与缺失的底账，不排期、不给方案。按 2026-07-31 的代码逐条核对，行号是核对过的。

---

壳是好的：自包含单文件、16:9、键盘与点击翻页、进度条、容器查询驱动字号，无外链（`tests/reading/slides/template.test.ts` 断言）。内容提示词也对——蒸馏不摘录、每页 3-5 条、给了固定的 class 词表。下面的问题都在壳与提示词之间那一层。

## 缺陷

### slides 的 plan 拿不到章节清单

`src/reading/slides/live.ts:80` 的 `planMaterial` 在有 overview 时只把 overview 喂进 plan 调用（:84），而 overview 的提示词明写它是 200-500 词的跨章综合、不是逐章摘要（`src/reading/notes/overview.ts:22`），里面没有章节编号。plan 的提示词却要求模型给出 `sourceChapters`（`src/reading/slides/plan.ts:39`、:53）。模型只能猜，`asChapters`（:110）只校验是正整数，不校验存在。猜错的章号让 `readChapterNote` 返回 null，`gatherSlideNotes`（live.ts:106）静默回落到该书 overview。结果是每张内容页蒸馏同一段框架，章节笔记一个字没用上。

没有 overview 时反而更好：回落路径（live.ts:87）给的是章号、标题和每章前 40 词。

### 图注识别与 bbox 判废

都在 `src/reading/figures/extract.ts`，两处独立成因。两处都修好，deck 里才可能出现书内原图。

图注这一半有三个成因。`captionLinesFromText`（:240）按基线 y 分行，不看 x 距离；双栏论文里左栏正文和右栏图注共享基线会被并成一行，图注不在行首，`figureCaptionId` 的行首锚定失败，整条 caption 丢掉，索引里连条目都没有。编号塌缩和中文图注这两处 2026-08-19 已修（见 docs/12）：编号保留全部节号，标签认中英两种，罗马数字仍不识别。第三处是 :251 的排序比较器不满足传递性（基线差 ≤3 按 x 比、否则按 y 比），基线密集时排序结果未定义，邻行的一个 run 插进来就能把一条图注切成两半、两半都匹配不上。

bbox 这一半：图注在图上方时 `pairFiguresOnPage` 拿不到任何区域（:465 把 caption 在 art 之上的配对排除），bbox 为 null，而 slides 的裁图路径见 null 直接返回 null（`src/reading/slides/live.ts:205`），槽位消失。图比图注窄时（:399 的 `wideEnough`）真实 bbox 被丢弃，但结果不是 null 而是 caption 锚定的回落区域——图注宽度乘上向上到最近正文行的一段（:412）。所以这一路给出的是一张按栏宽裁的带状图，不是那张图；正文行也没有时上界是页高的 0.6，裁出来的框会越过页顶。

### 论文与书用同一套假设，两边都不合身

管线不作区分。书这一侧：`chaptersFromOutline`（`src/reading/notes/plan.ts:63`）只取 outline 的 level 0，很多书 level 0 是"第一部分/第二部分"，于是变成三个上百页的"章"；每章一篇 300-700 词的笔记（`src/reading/notes/chapter.ts:147`），而读页工具每次最多 10 页（:180，`src/fulltext/format.ts:48` 强制）、16 轮上限（:18），覆盖不了。加上图注按章节编号造成的 id 塌缩，书这侧的图基本全丢。

论文这一侧：通常无 outline，落到 AI 兜底，而那个提示词开头写的是"给你一本书的前置部分，通常含目录"（plan.ts:75），对 12 页论文是错的框架；`toChapters`（:44）让最后一"章"延到末页，参考文献被当正文写进笔记；双栏图注丢失是论文侧的主要杀手。参考文献本身没被利用——`src/reading/papers/` 的引文解析只服务备课管线，`src/reading/notes/` 和 `src/reading/slides/` 不 import 它。

### 一键全书不覆盖 skipped 章

`planAutoNotes`（`src/reading/notes/auto.ts:78`）把前沿之后零划线的章标 `skipped`，`runChapters`（`src/reading/notes/pipeline.ts:305`）只跑 `pending`，面板的 Resume 走的是同一个 `ensureStarted`（:107，`NotesPanel.tsx:265`）。docs/14 第 32 行"手动一键按钮始终是最终兜底"与代码不符——同一份文档第 30 行的"面板留一个单章 Generate 兜底"才是实际行为（`NotesPanel.tsx:119`）。要覆盖只能逐章点 Generate。

一本只在几章划过线的书，笔记天然是残的。逐章标了"No marks — skipped"（`NotesPanel.tsx:127`），但 overview 在 done 加 skipped 就算 settled（pipeline.ts:226）后照常写出，Slides 弹窗里也没有任何地方说这本书只覆盖了几分之几。

### 产物三处丢人

内容同质，见上。

图槽普遍为空，而内容提示词允许模型在图下写一句话（`src/reading/slides/content.ts:22` 的 `takeaway`）；`injectAsset`（`template.ts:46`）会删掉占位符和空的 figwrap，但删不掉那句话，于是出现"如图所示"下面什么都没有。

溢出静默裁掉：`.slide`（template.ts:88）没有 overflow 处理，`.stage`（:84）是 `overflow:hidden`，bullet 写多了后几条看不见，生成时与放映时均无提示。

测试只覆盖壳（`tests/reading/slides/template.test.ts`），没有任何测试碰真实内容。

### 违反诚实失败

最直接的一处：图没取到时仍无条件把 `assetStatus` 标成 `done`（`src/reading/slides/pipeline.ts:249`，上一行的 `if (asset)` 只挡了写入 assets 表这一步），弹窗里显示绿色的 figure 徽标而 deck 里没有那张图。

其余：书单为空时 Generate 是静默 no-op（`SlidesDialog.tsx:157`，`selected` 初值含当前书 :119，所以按钮不 disabled，而 `books` 为空使 ids 为空直接 return）；`listBooksWithNotes` 在 `readDir` 抛错时静默返回空（`live.ts:63`）；图索引读失败被当成"这本书没有图"（`src/reading/figures/store.ts:45`，调用方一律 `?.figures ?? []`）；插图异常只 `console.warn`（pipeline.ts:256）；plan 编出的 `sourceChapters` 与 `figId`（plan.ts:144）都不做存在性校验，到 assets 阶段才发现然后标 done。抽取失败一律 `.catch(() => null)`（`src/App.tsx:1047`、`src/reading/prep/live.ts:202`），其中 fulltext 的失败在 Generate notes 时会弹提示（`src/reading/notes/use-notes.ts:212`），图索引失败对用户完全不可见。

### 清不掉、退不回的状态

图索引失败一次即永久为空：空索引被有意持久化以避免每次开书重试（`src/reading/figures/store.ts:84`、:87），而没有任何界面能清它，全仓没有删除 `figures-*.json` 的路径。

`talks.json` 解析失败返回空数组（`src/reading/slides/store.ts:43`），下一次 `appendTalk`（:50）即以空数组为基础覆写整个文件，所有已生成的 deck 从界面永久消失而 HTML 仍在盘上。

写盘成功但登记失败留下孤儿文件：`live.ts:228` 先 `writeDeck` 再 `appendTalk`，后者抛错时 run 报 assemble failed，HTML 已经在盘上了。

生成中途退出无 state.json，能重跑不能续跑（docs/14 第 77 行已声明这是 v1 的已知限制）。对照记一句：笔记那一侧的恢复是好的，中断的 running 归回 pending（`src/reading/notes/types.ts:67`），plan、章节、overview 各有重试。

## 缺失

不是坏了，是没做。

- deck 无重启恢复。
- deck 没有独立入口：只能开一本有笔记的书、进 Notes tab，且该书至少一章 done 才出现 Slides 按钮（`NotesPanel.tsx:240`）。
- 无 PDF 导出、演讲者备注、单页编辑、主题换肤（docs/14 第 82 行已列为待定）。
- 备课管线的笔记（`prep-<hash>/`，docs/09 第 48 行）完全不进 notes 与 slides，学习机模式预读的论文在 deck 里用不上。

## 未验证

图提取需要 DOM（`getOperatorList` 要 DOMMatrix），headless 跑不了整条管线。上面图注和 bbox 的成因是拿 `extract.ts` 的纯函数复现的，不是在真实 PDF 上跑出来的：双栏共享基线返回空数组、"Figure 1.1"与"1.2"塌成一个 id、比较器上 A<B 且 B<C 而 A>C、图注在图上方得到 null bbox、图窄于图注得到栏宽带状框，各自都跑通了。真实 PDF 里这些形状各出现得多频繁没有量过。
