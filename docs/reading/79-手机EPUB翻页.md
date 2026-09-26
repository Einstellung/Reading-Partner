# 79 手机 EPUB 左右翻页

2026-09-26 定。依据是探针实测 [phone-epub-pagination](../research/phone-epub-pagination.md)。手机阅读器在滚动（[70](./70-手机读EPUB.md)）之外加翻页，Aa sheet 里一个「Turn pages」开关切换。

## 定下的

- 两种模式都留。模式和字号、纸色一样是本机偏好，存在 `phone-display` 那格（`FlowDisplay.mode`，`"scroll" | "paged"`），不同步。默认 `scroll`，和 iPad EPUB 默认的竖排一致。
- 翻页的交互照搬 iPad 纸页（[64](./64-epub纸页.md)）：跟手拖、到书头书尾橡皮筋、松手过阈值翻页、不过就回原页，全走 `engine/gesture` 的 `attachTouchRouter`；点按区用 `reader-logic.ts` 的 `tapZone`，左右各 28% 翻页，中间不做事。翻页落定没有动画，和 iPad 一样直接到位。
- 顶栏页码和滚动模式一样显示分页表页号，不显示屏页数。
- 左缘返回：起点在壳的边带（`edge-back-gesture.ts` 的 `EDGE_ZONE`，24px）里归返回，其余右滑翻上一页。
- 图：`max-height` 是版心高、`object-fit: contain`、`break-inside: avoid`。

## 结构

`src/reading/epub/paged-view.ts` 实现和滚动同一个 `FlowReaderView`（`flow-contract.ts`）。`FlowReaderPane.tsx` 按 `display.mode` 挂 `createFlowReader` 或 `createPagedReader`，模式一变就销毁旧视图、用旧视图最后报的 ViewState 挂新视图，别的 display 变化照旧走 `setDisplay`。纯逻辑在 `paged-logic.ts`，测试在 `tests/reading/epub/paged-logic.test.ts`。

三层元素：

- `frame`：读点按、长按划线、边带仲裁。挂在路由元素外面，路由接管拖动时补发给原目标的那个 pointerup 在 scroller 冒泡处被截住（`attach-touch.ts` 的 `containSynthetic`），到不了 frame，不会被读成点按。
- `scroller`：`overflow: hidden`，`attachTouchRouter` 挂在这里，拖动写它的 `scrollLeft`。
- `strip`：scroller 的第一个子元素，橡皮筋平移它。上面并排放当前 spine 文档和前后各一个，每个一个 shadow host，按 spine 顺序首尾相接。

每个文档照 flow 挂载（`mountFlowDocument`、`flowBaselineCss`），再追加一条 `pagedColumnCss`：`.rp-paper` 宽高等于一屏，`column-width = W - 2padX`、`column-gap = 2padX`、`column-fill: auto`，第 k 列正好在第 k 屏。列数 `round(scrollWidth / W)`。host 不裁剪，列溢出在 strip 上，overlay 跟着溢出，所以标注的矩形按 host 坐标画就落在对的列上。纸色的 wash 在多列元素里只有第一列宽，这里在 shadow 里关掉，改成 strip 上一层 `mix-blend-mode: multiply` 的整条色层；strip 底色是纸面，frame 底色是 swatch，橡皮筋拉开露出的也是纸色。

路由看到的「页」是窗口页：窗口里三个文档的列按顺序编号，`getCurrentPage`/`getTotalPages` 按窗口算，所以跨章翻页对路由就是普通的下一页，书头书尾才橡皮筋。落到邻章后它成为当前文档，窗口重排（丢掉不再相邻的文档，同一帧里改 `scrollLeft`），缺的邻居 120ms 后在没有手指时挂上。点按翻页时邻居还没挂上就当场挂。图片加载完、改 Aa、尺寸变化都走 `reflow`：重数列数、重排窗口、按锚点落页；有手指在屏上就等抬手再做。

## 坐标换算

屏页不存。存盘、顶栏、[p.N] 引用都是分页表 v2 的 CFI 和页号，和滚动模式、iPad 互认。ViewState 照滚动模式写（`layout: "vertical"`、`scale: "auto"`），手机翻不翻页不写进书的状态。

- CFI → 屏页：`resolvePointRange` 在克隆树上解出 Range；折叠的 Range 扩成一个字符再取第一个矩形（元素位置取子元素的矩形），`columnAt` 按它离 host 左缘多远除以屏宽得列号。
- 屏页 → CFI：在当前屏版心里从上往下每 8px、行首和往里 40/120px 探点，`caretAtPoint` 拿第一个落在非空白字符上的 caret，出 CFI；整页没有字（插图页）按 `top-edge.ts` 的规矩取探到的第一个元素。
- 页号：`pageIndexOfCfi(pagination, anchor)`。

## 锚点

`anchor` 是一个 CFI，也是写进 ViewState 的那个 cfi。只在两种时候更新：用户翻页（拖动翻过去或点按）时取新页的第一个字；跳转（Outline、goToCfi、书内链接、引文）时取跳转目标本身。拖了没翻过去、改字号行距边距、尺寸变化、图片到达都不动锚点，只按它重新落页。切换滚动/翻页时，新视图按旧视图最后写的 cfi 落位：翻页写的是锚点，滚动写的是顶边第一个字。

## 划线（第一片的最小行为）

`flow-marks.ts` 原样接上，`flow-gesture.ts` 的按压状态机挂在 frame 上：长按 500ms 在字上起划，拿着 Highlight 笔按下即划；拿笔时路由把手指当笔（`tool: "highlight"`、`fingerDraw: true`），只从屏幕边带起的横滑翻页，和 iPad 拿笔时一样。点标注开弹窗、点链接跟链接，都在点按区翻页之前判。一页之内的划线、显示、删除可用；跨页延长、拖到页边自动翻页不做。以上在模拟器上都还没验。

## 第二片要接的

- 跨页划线：`paged-view.ts` 的 `feed` 里 `extend-mark` 分支；手指停在右缘时自动翻页要调 `turn(1)` 并在翻完后接着 `marks.extendDrag`。`rectsIn` 已经给出所有列上的矩形，跨两页的线两页各画各的。
- 引文回书：`highlightQuote` 现在翻到引文起点那页、在该文档 overlay 的 `.rp-quote` 子层画紫，没在模拟器上验；课堂回书的流程（[77](./77-手机EPUB课堂.md)）在翻页模式下要从头走一遍。
- 其它读位置的消费者：`top-edge.ts` 在翻页模式的等价物是 `anchorOfShown`（`pageProbePoints` + `isInkAt`）；课堂、Lumen 这些读当前位置的地方都应该读 ViewState 的 cfi，不要去量 DOM。
- Lumen 与翻页手势共存没验。
