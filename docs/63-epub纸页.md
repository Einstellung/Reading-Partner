# EPUB 纸页

EPUB 和 PDF 在阅读器里是同一种东西：桌上一张张纸。取代 docs/62 的 iframe 重排路线，docs/39 的「位置块」概念改为「排出来的页」。

## 页几何

一页 576×864 CSS 像素（6×9 英寸 @96dpi），版心 480×752（左右 48、上下 56），基础字号 16px、行高 1.55。常量在 `src/reading/epub/page-geometry.ts`，写进分页表的 `geometry` 字段；几何或字体名一变，旧表按不同的书对待（读作不存在）。

缩放是对整张纸做 `transform: scale()`。档位 0.5–3；竖排锁 fit-width，翻页锁 fit-page，fit 的算法复用 `engine/layout-settle.ts` 的 `fitScale`。`ViewState` 存 `pageIndex` + `pageX/pageY`（竖排时视口顶边在页内的未缩放坐标）+ `scale` + `layout`，`cfi` 存该页起点，恢复时按 CFI 在表里找页。

## 字体

排版不依赖系统字体。`public/fonts/` 打包 Noto Serif（Regular/Bold/Italic/BoldItalic，拉丁+希腊+西里尔子集）和 Noto Serif CJK SC Regular（GB 2312 + CJK 标点 + 全角，一个字重），`@font-face` 声明在 `styles.css`（文档级声明 shadow root 能用）。总量 2.86 MB（CJK 2.6 MB），OFL 许可证在同目录。生成脚本 `scripts/fonts/subset-fonts.py`。

书的 `font-family` 一律改写成打包的字体栈：书自带 `@font-face` 的字体名保留，通用族名和未内嵌的具名字体（Georgia、Times）全部换成 `"Noto Serif", "Noto Serif CJK SC", serif`，`monospace` 留通用。同一本书用 Georgia 回退排 73 页，用 Noto 排 74 页，不改写就没有跨设备一致的页码（坑 268）。

## 分页表 v2

`pagination-<bookId>.json`，`version: 2`：

```
{ version: 2, kind: "epub", source: "layout", geometry: {...}, spineCount,
  blocks: [{ spine, charOffset, endOffset, cfi, label }] }
```

一页一条：所在 spine、抽取文本里的起止偏移、起点 CFI、印刷页码（有 page-list 的书按该页起点落在哪个印刷页取）。每个 spine 文档从新的一页开始，一页不跨文档。`blockTexts`/`blockNumberAt` 不变，`Fulltext.pages[]` 仍是每页正文。

排版在 webview 里做（`page-ruler.ts`）：把消毒后的 spine 文档挂进一张离屏页卡片，CSS multi-column（列宽 480、列高 752、gap 0），第 k 列就是第 k 页；逐文本节点看 client rects 跨了哪些列，列边界上对字符偏移二分找第一个字；图/svg/hr 单独算一个原子。量尺接口 `PageRuler = (doc) => Promise<PagePoint[]>`，`paginate(book, ruler)` 只管把点变成表；测试用 `characterRuler(n)`。量尺返回的节点是克隆树的，必须经 CFI 解析回摄入树再取偏移（坑 267）。

一本书算一次：`ensurePagination` 单飞，摄入和阅读面板谁先到谁算，另一个等同一个 promise；`open-book.ts` 在读标注之前先算（`preparePages`）。同步来的表直接用；卡片按表里的起点 CFI 在自己的排版里找列，排版差一行也落在表说的那一行上。

## 页卡片

`page-card.ts`：一张 `.rp-page`（纸色、阴影同 `engine/page-frame.ts`），shadow root 里：基线样式 + `.rp-clip`（版心，`overflow: hidden; contain: paint`）> `.rp-columns`（multicol，`translateX(-k×480)`）> 原样克隆的 `<html>`，旁边一层 `.rp-overlay`（页坐标，给标注层用）。`<html>` 里不加任何节点，CFI 在摄入树和卡片树上同一棵。资源用 blob URL（`page-mount.ts`）：img/svg image/link 样式表（内联为 `<style>`）/style 里的 url()。

`reader-view.ts` 是桌子：一个滚动容器，每页一个固定尺寸的槽位，只有视口附近的槽位挂卡片（前后各一张），其余空着；同一 spine 文档在几张卡片里各有一份克隆。竖排一叠纸，翻页一屏一槽 scroll-snap。事件全在 app DOM 里：点击区、滑动、方向键在 `EpubReaderPane.tsx`，链接命中用 `shadowRoot.elementFromPoint`。引文高亮：在抽取文本里找到引文 → 定页 → 卡片树里同偏移取 Range → rects 画进 overlay；rect 落在纸外时把卡片移到引文所在列。

标注挂在这几个上：`card.overlay`、`card.rangeOf(cfi)`/`card.cfiOf(range)`、`card.rectsOf(range)`、`card.toViewport`/`fromViewport`、`controller.cardAt(x, y)`。

## 标注

盘上形状和 docs/39 §5 一样：高亮、划线、AI 笔是 `position` 里一条 range CFI（`FragmentSelector`）加顶层 `quote`，外加 `position.pageIndex`（新页号）、`pageLabel`、`sortIndex`（`spine|字符偏移`）。CFI 是主锚点，引文是修复；解出来的字和引文头 24 个非空白字符对不上就按引文重找（`sameWords`）。AI 笔到这一层就是划线加一个固定的紫，开线程是壳做的（`use-mark-doors.ts`），阅读器不知道有这回事。

墨迹是唯一按几何存的：`position` 是 `{ pageIndex, paths, width }`，`paths` 是每笔一条 `[x0,y0,x1,y1,…]`，单位是**页坐标**——576×864 的纸，原点左上，y 向下。这就是 overlay 自己的坐标系，不翻转。PDF 那边存的是 PDF 点、原点左下，`convert.ts` 进出各翻一次 y；EPUB 页没有 PDF 点，也没有那个约定要守。墨迹的 `sortIndex` 取所在页起点的字符偏移，一页上的几笔并列。

`annotationPage()` 两种格式读的都是 `position.pageIndex`，同步侧零改动。

画在每张卡片的 `.rp-overlay` 里，`.rp-marks` 一层、引文的 `.rp-quote` 一层，各清各的（坑 272）。文字标注按 CFI 解成 Range 取 `getClientRects()` 换页坐标，裁到版心（坑 271）；高亮铺整行、划线只画行底 2px，两者都是 `MARKUP_OPACITY`。墨迹一条 SVG polyline。选中态是绕外接框的一圈描边。卡片一换页就重画；缩放不用重画，overlay 在纸的坐标系里，跟着 `scale()` 走。

事件全在 app DOM：pane 的 pointer 先给标注层（`markPointerDown`），它按 `engine/gesture/touch-routing.ts` 的表判笔/手指/`fingerDraw`，接下了就 `setPointerCapture`，翻页和点击区再也读不到这个指针。文字笔从落点到抬手两次 `caretAtPoint` 建 Range —— 不走系统选区，阅读区 `user-select: none`（坑 49、262）；shadow root 上有 `caretRangeFromPoint` 就用它，没有就退回自己量：点下的元素、最近的文本节点、节点内二分找字符边界（`caret.ts`）。抬手写下 CFI、引文、页号，交给 `onSaveAnnotations`。没有工具在手就不消费指针，手势那边照常翻页。

点标注在页坐标里做命中测试（矩形 / 离墨迹路径的距离），发 `onAnnotationPopup({rect, annotation})`，rect 换回视口坐标。`navigate({annotationID})` 滚到那一页，标注落在纸外时按 `showColumnOf` 把卡片挪到它所在的列。

## 消毒边界

安全边界是消毒器。`sanitize.ts` 保留 `<style>`、`<link rel="stylesheet">`（只认 zip 内相对路径）和 `style` 属性，内容都过 `css-sanitize.ts`：删 `@import`/`@charset`/`@namespace`/`@page`/`@keyframes`，删 `behavior`/binding/`expression()`/script 协议，url() 只认 zip 条目（带协议一律删），`position: fixed/sticky` 改 `relative`，`font-family` 按上面的规则改写。输出规范化、幂等，`sanitize(sanitize(x)) === sanitize(x)` 仍成立。

## 迁移

v1 表读作不存在，打开时重算 v2 并覆盖（唯一一次允许重写），`annotations-<bookId>.json` 里带 CFI 的标注按 CFI 在新表里重算 `position.pageIndex`/`pageLabel`/`sortIndex`（`migrate.ts`）。`fulltext-*`/`figures-*` 缓存带 `paginationVersion`，不是 2 的视为过期重建（`FULLTEXT_VERSION`/`FIGURES_VERSION` 不动，PDF 缓存不受影响）。笔记里旧的 `[p.N]` 不管。

## 封面

`covers.ts` 遇到 EPUB 走 `epub-cover.ts`：只解 container 和 OPF，取 `cover-image`/`<meta name="cover">` 指的图，`<img>` + canvas 缩到 `COVER_WIDTH_PX` 出 JPEG，作者取 `dc:creator`。没封面图的书走现有的无封面卡片。

## 量出来的数（Linux WebKitGTK，xvfb，1280×860 阅读区）

| 书 | spine | 页数 | 首次分页含 fetch/解包 | 表大小 |
|---|---|---|---|---|
| 具身智能（2.3 MB，一个 158 KB spine） | 2 | 75 | 320 ms | 8.8 KB |
| The Experience Machine（10 MB，page-list） | 19 | 385（384 页有印刷页码） | 1.4 s | 52 KB |
| Active Inference（71 MB） | 70 | 1557 | 6.8 s（fetch 0.6 s） | 154 KB |

有表的书重开 110–130 ms。翻页 3–4 ms。71 MB 那本打开后 WebKitWebProcess RSS 1.19 GB（对照另一个空闲 WebContent 进程 572 MB）。Chromium 与 WebKitGTK 的分页差异没量。
