# EPUB 支持调研

只读代码得出的结论，没有跑过任何 EPUB。取代 `north-star/epub.md` 里"位置体系全面分叉"的判断。

## 结论

页码不用废掉。EPUB 3 自己就带印刷页码（`<nav epub:type="page-list">` 加 `epub:type="pagebreak"` 锚点，从纸书转的书基本都有），没有的按固定字符数切合成页。`Fulltext.pages[]`、`[p.N]`、章节页区间、BM25 检索单元、observation 全部原样保留。真正要新增的是一层精确位置，只有阅读位置和标注两样东西用它。这比"接引擎"小，不比它大。

引擎选 foliate-js。

headless 摄入值得先做，但不是"EPUB → 完整 Fulltext"，是"EPUB 只当图源"：解 zip 拿真图和真图注，按图注文本对到 PDF 的页上。一两天，不动任何锚点。

本仓库没有 Zotero API。`src/platform/sync/` 里 `zotero` 零命中，同步目标是 Google Drive，按 `id` 合并 `annotations-<bookId>.json` 的数组元素，从不读 `position` 里面。这条的改造量是零。

## 一、位置抽象

### 页码在哪里是数据，在哪里只是显示

不可重建的持久化只有两处：`reading-state.json` 的 `ViewState`，和 `annotations-<bookId>.json` 的 `position.pageIndex` + PDF 点坐标 `rects`。其余带页码的文件（`fulltext-*.json`、`figures-*.json`、`prep-*/chapters/state.json`、`prep-*/state.json`）都是派生的，版本号一升就重算，迁移成本为零。

第三类最麻烦：`prep-*/chapters/chapter-NN.md`、`prep-*/chapters/overview.md`、`prep-*/<slug>.md` 里散落着 AI 写进正文的 `[p.N]`。没有任何东西会重写它们。页码含义一变，这些字符串就永久指错地方。

纯显示的页码（顶栏 `12 / 400`、大纲右侧页码列、痕迹行的 `Page N`、书架进度条、`Fig. 3 · p.7`）不存盘，随便改。

### 做法

`Fulltext.pages[]` 的语义从"PDF 的第 i 页"放宽成"文档的第 i 个位置块"。EPUB 的位置块按这个顺序取：

1. `page-list` 导航文档里的印刷页码，配合正文里的 `epub:type="pagebreak"` 锚点。这时 `[p.N]` 就是纸书页码，和同一版的 PDF 对得上。
2. 没有 `page-list` 就按固定字符数切。Zotero 用 1800 字符一块，epub.js 默认 1600，取一个定死不再改。

分页表单独存 `pagination-<bookId>.json`，写一次永不重算，跟着 Drive 同步。不放进 `fulltext-*.json`：那个文件是派生的，`FULLTEXT_VERSION` 一升就重建，重建出不同的分页就把已经写进笔记的 `[p.N]` 全部悄悄挪位。

精确位置新增一层，PDF 和 EPUB 共用一个联合类型、两个实现：

```ts
export type Locator =
  | { kind: "pdf"; pageIndex: number; pageX?: number; pageY?: number }
  | { kind: "epub"; cfi: string };
```

`Fulltext` 加两个可选字段：`pageLocators?: string[]`（每个位置块起点的 CFI，用于 `[p.N]` 跳转）和 `pageLabels?: string[]`（显示用的印刷页码）。`kind?: "pdf" | "epub"` 缺省 `"pdf"`，老文件照常解析。

`ViewState` 加可选 `cfi?: string`，`pageIndex` 继续填合成页号供显示和续读粗定位，恢复位置时有 `cfi` 优先用 `cfi`。这个文件已经带着三个上一代引擎留下的死字段（`top`/`left`/`spreadMode`），加字段是它既有的演进方式。

选 CFI 不选 spine + 段落序号：两个候选渲染器都原生说 CFI；标注在盘上的 schema 本来就叫 Zotero，Zotero 的 EPUB 标注就是 `epubcfi`；字符偏移表达不了落在标签内部的区间端点，而且正文抽取逻辑一改就全体漂移。CFI 之外再存一份引文加前后文（Web Annotation 的 `TextQuoteSelector` 形状）作修复兜底。

CFI 的下标数的是子节点序号，往 DOM 里注入或删除节点就会整体错位。算 CFI 要对着消毒后、注入前的那棵树算，渲染器解析 CFI 时按标记过滤掉自己注入的节点。foliate-js 的 `epubcfi.js` 支持这个过滤。

### 受影响文件

核心类型，18 个文件里真正要改的是这 6 个：

| 文件 | LOC | 改动 |
|---|---|---|
| `src/fulltext/types.ts` | 33 | 加 `kind` / `pageLocators` / `pageLabels` |
| `src/platform/app/reader-contract.ts` | 119 | `ViewState` 加 `cfi`；`navigate` 和 `highlightQuote` 收 `Locator`；`annotationPage()` 对 EPUB 返回 null |
| `src/reading/engine/convert.ts` | 318 | 现有 318 行一行不动，旁边加 EPUB 的 position 编解码 |
| `src/reading/figures/types.ts` | 50 | `bbox` 换成 `source` 联合，见第三节 |
| 新增 `src/reading/locator.ts` | ~60 | `Locator` 和两边的转换 |
| 新增 `src/reading/epub/` | — | 解包、解析、分页、CFI，见第二节 |

不用改的（点名，因为直觉上像要改）：

- `src/reading/reading-position.ts`（108 行）零改动，它只是个按 `bookId` 的防抖写入器，页码全在 `ViewState` 里。
- `src/reading/prep/anchors.ts`（328 行）零改动。`[p.N]` 的语法、href 编解码、`page > 0` 的校验全部继续成立，因为合成页号也是从 1 开始的正整数。
- `src/memory/observations/` 不存页码，`Observation` 的锚点是标注 id 和消息 id。只有 prompt 里出现 `p12`，`page: number | null` 已经允许 null。
- `src/reading/slides/` 没有自己的页码，页码只从 `BookChapter` 进来；`slides/outline.ts` 已经在发 `startPage: 0, endPage: 0` 的章节，并注明下游没人读。
- `src/platform/sync/` 全部。

改动集中在两个实现分叉点，不是散在 60 个文件里：`EmbedReaderPane.tsx`（237 行）现在是 `EmbedPdfHandle` 到 `ViewInstance` 的唯一桥，加一个同样实现 `ViewInstance` 的 `EpubReaderPane`；`src/fulltext/extract.ts`（180 行）加一个 EPUB 分支产出同形状的 `Fulltext`。`EmbedPdfHandle` 本身保持 PDF 形状，不去泛化。

`App.tsx` 里 `pageIndex ± 1` 的十来处、`jumpToQuote` 都不用动：它们操作的是位置块序号。`jumpToQuote` 尤其省事，它先在 `ft.pages[pageIndex]` 里 `locateQuote` 定位精确子串，再交给引擎做文本搜索——页号只用来缩小范围，真正的定位是文本。EPUB 侧照抄这条路即可。

测试：`tests/reading/prep/anchors.test.ts`（326 行）那张必须原样存活的括号表不受影响。要改的是 `tests/fulltext.test.ts`、`tests/reading/prep/classroom.test.ts`，以及新增 EPUB 解析的单测。`src/reading/engine/layout-settle.test.ts`（488 行）和 `layout-modes.test.ts`（239 行）是 EmbedPDF 的几何，与 EPUB 无关。

## 二、引擎选型

| | foliate-js | epub.js |
|---|---|---|
| 许可证 | MIT | BSD-2-Clause |
| npm | 作者没发。npm 上的 `foliate-js@1.0.1` 是 `shmandadi@skillsoft.com` 发的，不是作者 | `epubjs@0.3.93`，最后一版 2022-02 |
| 维护 | 仓库 2026-05 有提交，60 个 open issue | 仓库 2026-03 有推送，517 个 open issue |
| 体积 | EPUB 那条路 `epub.js` 43K + `epubcfi.js` 13K + `paginator.js` 44K + `view.js` 23K + `overlayer.js` 7K + `search.js` 6K，约 136 KB 未压缩源码，无运行时依赖 | 依赖 jszip、marks-pane、event-emitter |
| 分页 | CSS multi-column，`flow` 可选 paginated / scrolled | CSS multi-column |
| CFI | `epubcfi.js`，支持过滤注入节点 | 有 |
| 标注 | `overlayer.js`，SVG 覆盖层加 `hitTest(event)`，`draw` 函数可返回任意 SVG | `rendition.annotations.highlight/underline/mark` |
| book 对象 | 是可替换接口 | 不可替换 |

选 foliate-js。决定性的是最后一行：它的 book 对象是一份接口而不是一个实现，`sections[].load()` 返回一个待渲染的 URL、`createDocument()` 返回 `Document`、`resolveCFI(cfi)`、`resolveHref(href)`，压缩包一侧是 `loadText(path)` / `loadBlob(path)` / `getSize(path)`。我们自己实现这套接口，就能把消毒和资源改写卡在渲染器看见内容之前，而不是事后补救。

不放 npm 依赖，vendor 到仓库根的 `vendor/foliate-js/`，vite 里配别名。这样不用往 `tests/layering.test.ts` 的 LAYER 表里登记第三方目录（表里每个存放源文件的目录都得有键）。项目此前有过 `vendor/reader/`，路子是通的。

自己渲染 XHTML 等于重写 CFI 解析和 multi-column 分页，不做。

### 消毒

foliate-js 的 README 自己写着：不上 CSP 就别用任何电子书库，因为 EPUB 里可以有 JavaScript，而内容是同源提供的。本项目当前的 CSP 是 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`，加上 `connect-src ipc:`，书里的一段内联脚本就是 app 权限。四道一起上：

1. 每个 spine 文档先过 DOMParser（`application/xhtml+xml`）加白名单树遍历再重新序列化。删 `script`/`iframe`/`object`/`embed`/`base`，删所有 `on*` 属性，删 `javascript:` 和 `data:` 的 href。别用正则匹配标签——坑 125 记的就是正则在第一个 `>` 处断标签，`<marquee title="a>" onstart=...>` 直接放行。坑 126 要求 `sanitize(sanitize(x))` 逐字节等于 `sanitize(x)`，坑 127 记的是解析树写回去不一定能原样重解析。`src/info/extract/sanitize.ts` 已经有这套经验。
2. iframe 上挂 `sandbox="allow-same-origin"`，不给 `allow-scripts`。同源换来 DOM 访问和 CFI 计算，脚本一律不执行。
3. 每个 `src`/`href`/CSS `url()` 重写成从 zip 里取出的 `blob:`，绝对 http(s) 地址一律丢弃。不落地远程请求。壳侧已有 `img:` 自定义协议（`src-tauri/src/image_proxy.rs`），要走协议而不是 blob 也有先例。
4. CSP 的 `frame-src 'self'` 要加 `blob:`，现在会挡掉 blob iframe。坑 99 记着 Tauri 的 `on_navigation` 看得见每个 frame 的导航且会静默取消，`blob:` 放行、`data:` 取消——所以载体必须是 blob。

字体解混淆要 SHA-1 和 Web Crypto，需要 secure context。

### 现有适配层能复用多少

`src/reading/engine/` 约 6845 行，EPUB 用不上其中绝大部分：`EmbedPdfView.tsx`、`wire-engine.ts`（1028 行）、`convert.ts` 的坐标翻转、`raster.ts`、`layout-settle.ts`、`page-frame.ts` 全是 PDFium 几何。`PdfAnnotationObject` / `Rect` / `pageIndex` 这套形状不要去泛化。

能复用的是它上面那层：`src/platform/app/reader-contract.ts` 自称"引擎中立的壳与引擎之间的契约"，`Annotation` 声明成 `{ id: string; type: string; [key: string]: unknown }`——盘上的标注 schema 本来就是开放的，装一个 CFI 形状的 `position` 不用改类型。`EmbedReaderPane.tsx` 是它的第一个实现，EPUB 写第二个。

手势那半（`gesture/` 约 2300 行）是按 EmbedPDF 每页 div 写的（坑 37 说那些 div 所有模式都 `touch-action: none`），iframe 里要重做。`touch-routing.ts`（267 行，纯函数带单测）里的判定逻辑可以搬，事件接线不能。

## 三、图管线

`src/reading/figures/` 现在 1144 行加 668 行测试。`extract.ts` 638 行拆成 11 个阶段：op code 表、CTM 栈图形盒遍历、噪声过滤、并查集聚类、文本行重组配合 `figureCaptionId` 认图注、图注与区域配对（含跨栏守卫）、标签吸收、宽度兜底、坐标翻转、跨页去重。其中 1–4 和 6–9 全部是在还原 PDF 没有陈述的几何。EPUB 有 `<img>` 和 `<figcaption>`，这些整块不需要。

EPUB 侧建目录：遍历 spine 文档里的 `<img>` / `<svg><image>` / `<figure>`，每个图记下 zip 里的条目路径、所在 spine 项、以及它所在位置块的合成页号。

编号：图注文本能过 `extract.ts` 的 `figureCaptionId` 就沿用书上印的号，`[fig:3]` 的含义与 PDF 侧一致。匹配不上就发 `c3-2`（第 3 章第 2 张）。`lookup.ts` 的 `normalizeFigureId` 只剥标签前缀和标点，`c3-2` 原样通过，不会撞号。

图注逐级退：`<figcaption>` → `alt` → `aria-label` / `title` → 紧邻段落（短且像图注才取） → 视觉模型看一眼。前四级在摄入时同步做完，第五级按需触发并落盘。

视觉模型这条是新的：现在全仓库唯一把图交给模型的路径就是 `view_figure` 自己（`tools.ts` 把 JPEG base64 塞进 `ToolResult.images`），没有独立的"描述这张图"helper，也没有任何地方持久化过图的描述。要加的是 `Figure.caption` 旁边一个 `captionSource: "figcaption" | "alt" | "nearby" | "vision" | "none"`，并升 `FIGURES_VERSION`（现在是 4，每次升都是直接丢弃重建的，先例在）。`store.ts` 已有的 `ok | failed` 加 24 小时重试模型直接扩展给视觉描述用。

类型改成：

```ts
export type FigureSource =
  | { kind: "pdf"; bbox: FigureBBox | null }
  | { kind: "epub"; href: string };   // href 是 zip 内条目路径
```

`Figure.page` 保留（合成页号），`catalog.ts` 的 `- [fig:3] p.7 — 图注` 和按当前页就近截断照旧。

`view_figure` 的入参 schema 不用改，它本来就只收 `{ id }`。改的是取图：`render.ts`（138 行）现在用 pdf.js 重画整页再平移裁剪，EPUB 分支直接把 zip 里的图片字节原样返回，比裁 PDF 更清楚也更快。两个例外要处理：SVG 要先画到 canvas 再转位图；超大图要压到 `view` 档现有的约 1 MB 上限内。

`slides/live.ts` 的 `renderFigureAsset` 现在硬要求 `bbox` 非空，改成"`source` 可解析"。

## 四、先做 headless 摄入

值得做，但收窄成"EPUB 只当图源"，不做完整 Fulltext 替换。

做法：用户在同一本书上同时挂 PDF 和 EPUB，解 EPUB 的 zip 建图目录，拿真图注和真图片；每张图按图注文本（没图注就按邻近段落）在 PDF 的 `Fulltext.pages[]` 里搜一次，定出 `Figure.page`。图注是高区分度字符串，这个匹配便宜且稳。其余一切不动：页码、锚点、阅读、跳转全在 PDF 上。

收益：书的图第一次有可靠图注和原始分辨率，`extract.ts` 那套 bbox 猜测在有 EPUB 的书上直接绕过。代价一两天。前提是用户手上确实两个格式都有，且只对这些书生效，不改任何默认路径。

不做的是中间那档"拿 EPUB 正文清洗 PDF 的每页文本"。它要在 EPUB 段落和 PDF 页之间建单调对齐，工作量和直接做完整 EPUB 摄入是一个量级，交付的东西却少得多。

另外记一条：`prep/digest.ts` 里已经有一条没有页码的文档路径（抓来的网页文章，prompt 明说"它没有页码，别用 `[p.N]`"，`prep/live.ts` 给它一个单元素 `pages[]`）。这是仓库里唯一现成的无页码文档先例，EPUB 不该走它——EPUB 有结构，退化成一页就把章节信息扔了。

## 五、标注同步

前提要更正：本仓库没有 Zotero API。`src/platform/sync/` 里 `zotero` 零命中。"Zotero" 只是上一代引擎留下的盘上 JSON schema 的名字（`ZoteroAnnotation` 声明在 `src/reading/engine/convert.ts:25`），保持不变是为了老文件不用迁移。真正的同步后端是 Google Drive：`annotations-<bookId>.json` 被 `merge/records.ts` 当成 `{ kind: "array", idField: "id" }` 按记录合并，合并逻辑从不进 `position`。

所以同步侧改动为零。EPUB 标注的 `position` 直接照抄 Zotero 自己的 EPUB 形状：

```json
{ "type": "FragmentSelector",
  "conformsTo": "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
  "value": "epubcfi(/6/18!/4/68/2,/3:189,/3:491)" }
```

`sortIndex` 那边 Zotero 的 PDF 是三段 `页|上边距|左边距`，EPUB 是两段 `spine 序号|字符偏移`。`makeSortIndex` 加个同族函数即可，同一本书内不会混用两种键，字典序仍然正确。

`annotationPage()` 对 EPUB 标注返回 null。调用方的类型已经是 `number | null`（`distill.ts`、`arrears.ts`、`use-notes.ts` 都是），要检查的是痕迹列表那行 `Page {pageLabel}` 的显示——改读 `Annotation.pageLabel`，Zotero 给 EPUB 标注也填这个字段。

顺带：zotero/reader 是 AGPLv3（`COPYING` 明写），代码一行都不能抄。上面引的是它公开的数据格式，不是实现。

## 六、分阶段

| 阶段 | 内容 | 量级 | 独立价值 |
|---|---|---|---|
| 1 | EPUB 当图源（第四节） | 1–2 天 | 有 EPUB 的书，图注和图第一次是真的 |
| 2 | intake 认 EPUB + EPUB → `Fulltext` + 分页表 + 大纲，不接引擎 | 3–5 天 | 只有 EPUB 的书第一次能被 AI 通读和讲；阅读区先给纯文本降级视图 |
| 3 | 接 foliate-js：滚动/翻页、主题字号、位置持久化、`[p.N]` 跳转 | 1–2 周 | 能读了 |
| 4 | EPUB 标注：选区 ↔ CFI、overlayer、同步 | 1 周 | 痕迹、蒸馏、笔记在 EPUB 上闭环 |
| 5 | 图的视觉描述与落盘缓存；iPad 手势对齐 | 1 周 | 没图注的书也有图目录 |

阶段 2 要顺带改的小东西：`sources/url.ts` 的 `SniffedKind = "pdf" | "html"` 加 `"epub"`（magic 是 zip 的 `PK\x03\x04` 加 `mimetype` 条目内容 `application/epub+zip`）；`library.ts:22` 的 `libraryPdfPath` 把 `.pdf` 写死在路径里，要按 format 取扩展名；`library.json` 的 `LibraryEntry` 加 `format`。书的身份仍是字节的 SHA-256，与格式无关，这块不用动。

zip 解压用 fflate（MIT，0.8.3，无依赖）。XHTML 用 DOMParser，测试环境要确认 happy-dom 和 jsdom 认 `application/xhtml+xml`。

## 七、只有真机才能验的

- iOS WKWebView 自定义协议下能不能建 `blob:` iframe。坑 99 记的是桌面 WebKitGTK 的 `on_navigation` 行为，iOS 侧没测过。
- COEP `require-corp` 下 blob iframe 和 blob 资源是否放行。坑 33 记着 iOS 自定义协议下没有跨源隔离。
- 长章节上 CSS multi-column 的分页耗时和内存。docs/08 记过 WKWebView 有页面进程内存上限，PDFium 的堆已经占了一份。
- iframe 里的文本选择手柄和系统 callout。坑 49 是在阅读区根节点关掉 `user-select` 解决的，这次要在 iframe 里重新面对。
- 笔手路由。坑 37/38/117 那套是给 EmbedPDF 的页 div 写的，iframe 里要重来，且坑 117 记着 iOS 和桌面的触摸抢占参数完全不同。
- Web Crypto 的 SHA-1 在自定义协议下可用（字体解混淆），`Intl.Segmenter` 可用（搜索分词）。
- iPad 上 EPUB 排版的 CJK 字体回退。
