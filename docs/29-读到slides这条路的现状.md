# 读到 slides 这条路的现状

> "开一本书或一篇论文，读它，出一份 slides" 这条路今天实际停在哪里。上游是 [14](./14-PPT.md)（PPT 的设计共识）和 [09](./09-学习机模式.md)（备课管线）。缺陷与缺失的底账，不排期、不给方案。2026-07-31 逐条核对；2026-08 起大部分已修，逐条现状记在各小节标题下，仍未修的保留原有分析。

> 2026-08-21：这条路整体等重做。PPT 和演讲将来和语音功能一起重新设计，在那之前本文列的缺陷不排修复——包括 `slides/store.ts` 的 talks.json 坏读丢登记表那条。底账继续记着，是为了重做时知道旧的哪里不成立。

---

壳是好的：自包含单文件、16:9、键盘与点击翻页、进度条、容器查询驱动字号，无外链（`tests/reading/slides/template.test.ts` 断言）。内容提示词也对——蒸馏不摘录、每页 3-5 条、给了固定的 class 词表。下面的问题都在壳与提示词之间那一层。

## 缺陷

### slides 的 plan 拿不到章节清单

已修 2026-08：plan 现在先读这场讲已经定下的决定（`readDeckOutline`／`applyTalkOutline`，`src/reading/slides/live.ts:260-280`），把决定排成页；`validateDeckPlan` 当场校验 `sourceChapters` 与 `figId` 存在，读不到就在该页 `planNotice` 上说清楚，不再静默回落到全书 overview。原来"整章号靠猜"的回落路径只在这场讲什么都还没定时才走。

### 图注识别与 bbox 判废

都在 `src/reading/figures/extract.ts`，两处仍未修，行号已按当前代码更新；编号塌缩、中文图注、图比图注窄时的错误带状裁图三处已修（见下）。

图注这一半有两个仍未修的成因。`captionLinesFromText`（`extract.ts:296`）按基线 y 分行，不看 x 距离；双栏论文里左栏正文和右栏图注共享基线会被并成一行，图注不在行首，`figureCaptionId` 的行首锚定失败，整条 caption 丢掉，索引里连条目都没有。排序比较器（`extract.ts:307`，基线差 ≤3 按 x 比、否则按 y 比）不满足传递性，基线密集时排序结果未定义，邻行的一个 run 插进来就能把一条图注切成两半、两半都匹配不上。编号塌缩和中文图注已修（2026-08-19，见 docs/12）：编号保留全部节号，标签认中英两种，罗马数字仍不识别。

bbox 这一半：图注在图上方时 `pairFiguresOnPage`（`extract.ts:505`）拿不到任何区域（caption 必须在 art 下方才配对），bbox 为 null，而 slides 的裁图路径见 null 直接返回 null（`src/reading/slides/live.ts`），槽位消失——这条仍未修。图比图注窄时的回落已修：`wideEnough`（`extract.ts:455`）判定不够宽后，先试 caption 锚定的回落区域，回落区域仍不够宽就直接给 null，不再像原来那样拿一张按栏宽裁的带状图顶替。

### 论文与书用同一套假设，两边都不合身

已修／整合 2026-08：管线搬到 `src/reading/prep/chapters/`。论文侧的引用摘要现在是完全独立的一条管线 `src/reading/prep/papers/`（消化一篇文档引用的参考文献），不再和书共用同一套 outline／plan 假设。但两条管线都不进 slides：`src/reading/slides/` 与 `src/reading/talks/` 对 `prep/papers/` 零 import。这个缺口留在 [31](./31-读完之后的梳理与讲.md)「前提与缺口」，这里不重复。

### 一键全书不覆盖 skipped 章

已修 2026-08-19：`skipped` 状态和划线前沿驱动的逻辑一并删掉，改成全书全备，不再有"没覆盖到"的章（docs/09「触发：两条，没有开关」，docs/14 补记）。

### 产物三处丢人

内容同质：见"slides 的 plan 拿不到章节清单"，已修。

图槽空文字残留：`injectAsset`（`template.ts:172`）仍然只删占位符和空 `figwrap`，不删 `takeaway` 文字，但提示词已经改口——`contentSystemPrompt`（`content.ts`）明写"the shell...drops it if the asset is unavailable — so still write a slide that reads without the image"，要求模型写一句离开图片也能读的话，不再默认"如图所示"。

溢出改成两头报：生成时按模板尺寸估算记在该页状态里（`overflow.ts`），放映时壳自己量 `scrollHeight` 出提示（`template.ts` 的 `.overflow-warn`）。

测试已覆盖内容：`tests/reading/slides/{content,pipeline,plan,outline,deck-chapters}.test.ts`，不再只测壳。

### 违反诚实失败

已修 2026-08：`assetStatus` 现在取到图才 `done`，取不到是 `missing` 并写 `assetError`（`pipeline.ts:376-378`）；plan 编出的 `sourceChapters`／`figId` 当场做存在性校验（`validateDeckPlan`）；旧的"书单为空 Generate 静默 no-op"入口（`SlidesDialog.tsx`）整个删掉，改成讲里的 Deck 按钮（`DeckDialog.tsx`），不再有选书这一步。图索引失败的可见性见下一节。

### 清不掉、退不回的状态

图索引失败不再永久为空：`FIGURES_RETRY_AFTER_MS`（`src/reading/figures/store.ts:35`）24 小时后重试，`figuresCacheFresh`（:46）区分 failed 与空。生成中途退出已能续跑：`state.json` 是恢复点（docs/31「已解决」，`0d4acc6`），不再是"能重跑不能续跑"。

以下两条仍未修：`talks.json` 解析失败仍返回空数组（`loadTalks`，`src/reading/slides/store.ts:159`），下一次 `recordTalk`（:172）即以这份空数组覆写整个文件——所有已生成的 deck 从界面永久消失，HTML 仍在盘上。`runthrough/store.ts` 吸取了这个教训（读不出时把坏文件挪开，见 `tests/reading/runthrough/store.test.ts` 的注释），但 `slides/store.ts` 本身没有照做。解法现成：改走 `platform/app/atomic-fs` 的 `readGuardedJson`，同 `saved-articles.ts`。写盘成功但登记失败仍留孤儿文件：`live.ts:362` 先 `writeDeck` 再 `recordTalk`（:373），后者抛错时 HTML 已经在盘上，登记没跟上。

## 缺失

- deck 无重启恢复。已修，见上「清不掉、退不回的状态」。
- deck 没有独立入口。已修：入口在讲里（`DeckDialog.tsx`），Notes tab 已删（docs/14）。
- 无 PDF 导出、演讲者备注、单页编辑、主题换肤。仍未做，见 [31](./31-读完之后的梳理与讲.md)「后续待定」，这里不重复。
- 备课管线的论文材料不进 slides。仍未接，见 [31](./31-读完之后的梳理与讲.md)「前提与缺口」，这里不重复。

## 未验证

图提取需要 DOM（`getOperatorList` 要 DOMMatrix），headless 跑不了整条管线。上面图注和 bbox 的成因是拿 `extract.ts` 的纯函数复现的，不是在真实 PDF 上跑出来的：双栏共享基线返回空数组、"Figure 1.1"与"1.2"塌成一个 id、比较器上 A<B 且 B<C 而 A>C、图注在图上方得到 null bbox、图窄于图注得到栏宽带状框，各自都跑通了。真实 PDF 里这些形状各出现得多频繁没有量过。
