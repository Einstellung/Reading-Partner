# EmbedPDF 替换 spike 实测结果

> historical：spike 已执行并落地，EmbedPDF 是唯一引擎。文中路径已搬家：`src/reader-embedpdf/` → `src/reading/engine/`，`tests/reader-embedpdf-convert.test.ts` → `tests/reading/engine/convert.test.ts`；`VITE_ENGINE` 开关和 zotero 那条路径都已删除。worker 引擎已是默认，直连降级成 15s 探针超时后的兜底；wasm URL 必须是绝对地址，跨源隔离不是必需条件（pitfall 21）。

## 为什么换引擎

2026-07-16 定稿。zotero/reader 的 AGPL 与 App Store 冲突（见 `11-iOS-TestFlight发布.md`），issue zotero/reader#231 已发出但无回音；EmbedPDF core 与全部标准插件 MIT，PDFium 走 Apache-2.0（repo LICENSE + LICENSE.pdfium: https://github.com/embedpdf/embed-pdf-viewer），还顺带解除对 CDS 授权的长期依赖、不挡商业化。决定不等 CDS 回复，直接换。只考虑 PDF，不管 EPUB/snapshot。

插件矩阵覆盖我们对引擎的全部真实依赖，headless/vanilla 接入成熟，支持从内存字节加载、host 独立持久化、批注挂任意自定义字段——有条件可行。代价在适配层形态变了：原来是在 iframe 里调一个 `window.createView`，拿回封装好的 view 实例；换 EmbedPDF 后要自己装配 PdfiumEngine + PDFCore + 约十二个 plugin，并把 zotero 那套聚合好的回调（`onChangeViewStats`、`onSetAnnotationPopup` 的视口 rect 等）从各插件 state 里自己拼出来。不是难，是工作量前移到自己身上。

## WASM 与重计算的边界(2026-07-16 讨论补充)

EmbedPDF 的 WASM 是 PDFium(C++)编译产物,渲染是黑盒调用,我们不写渲染代码。将来的重计算(如向量检索)放 Tauri Rust 侧走 command,不放 webview 内 WASM:WKWebView 有页面进程内存上限,PDFium 堆已占一份。用 Rust 写保留"将来编译成 WASM 上纯网页版"的退路。

2026-07-16。分支 `spike/embedpdf`。只做 PDF。桌面 + headless Chromium 实测，未测 iOS/WKWebView、未测 WebKitGTK 拖选延迟。

以下逐条给 spike 前那批存疑项（编号 3-8）的实测结论。验证靠 `embedpdf-spike.html` + `src/reader-embedpdf/spike-harness.tsx`（Vite dev 起，Playwright 驱动），批注转换器另有纯函数单测 `tests/reader-embedpdf-convert.test.ts`（`bun test`，9 pass）。

## 存疑项结论

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| 3 | 坐标系原点与 Y 翻转 | 成。EmbedPDF 页坐标是 top-left 原点（y 向下），zotero 是 PDF pt bottom-left。翻转公式 `embedY = pageH - zoteroYTop`，宽高不变。实测精确：zotero rect `[100,650,300,662]` 在 792pt 高页上 → segmentRect `origin{100,130} size{200,12}`（792-662=130），程序化建注反向也精确回到 `[90,658,330,672]`。 | 转换器单测 + harness dumpEmbed |
| 4 | viewState 精确还原 | 部分成。页码 + 缩放精确还原（请求 page=6 zoom=1.5，重开落在 pageIndex 6 / zoom 1.5）。页内精确 scrollTop 未做——`scrollToPage` 支持 `pageCoordinates{x,y}` 可做到，本 spike 只还原到页顶。 | harness URL 参数重载 |
| 5 | 程序化 scroll-to-annotation | 成。`selectAnnotation(pageIndex,id)` + `scrollToPage({pageNumber, pageCoordinates:{x,y}, alignY})`。实测从第 8 页跳到 seed 批注（第 1 页）落回 pageIndex 0。 | harness navigateToAnnotation |
| 6 | highlight 建注取原文 | 成，但 highlight 对象本身不存原文（`PdfHighlightAnnoObject` 无 text 字段，确认）。适配层在 `selection.onSelectionChange` 时缓存 `getSelectedText()`，建注事件里塞进 zotero.text。实测真拖选建高亮，带出原文 `"gal,brendan,...@mozilla.co"`。 | harness 真鼠标拖选 |
| 7 | custom 字段 round-trip | 成。text/tags/aiThreadId/starred/pageLabel/dateCreated 装进 `custom`（EmbedPDF `custom?: any` 透传），import→存→改色改 comment→仍在。 | 单测 + harness update 后 dump |
| 8 | openDocumentBuffer 吃字节 | 成。直接吃内存 ArrayBuffer 渲染，无临时文件。注意引擎 API 是 `openDocumentBuffer({id, content: ArrayBuffer})`，doc-manager 插件是 `{buffer: ArrayBuffer}`；类型都要 ArrayBuffer，Uint8Array 传 `.buffer`。 | harness 从 fetch 的 buffer 渲染 |

## 标注落盘格式

标注在盘上的形状是 `ZoteroAnnotation`（`src/reading/engine/convert.ts`）：`packCustom`/`readCustom` 把 text、tags、pageLabel、aiThreadId、starred、dateCreated 转进/转出 EmbedPDF 标注对象的 `custom` 字段（存疑项 7）。真实样例：

```json
{
  "type": "highlight", "color": "#ffd400",
  "sortIndex": "00000|000500|00100", "pageLabel": "1",
  "position": { "pageIndex": 0, "rects": [[100, 650, 300, 662]] },
  "text": "选中的原文", "comment": "", "tags": [],
  "id": "QLCS27GS", "dateCreated": "2026-07-12T06:34:25.037Z",
  "dateModified": "2026-07-12T06:34:25.037Z",
  "authorName": "Reading-Partner", "isAuthorNameAuthoritative": true
}
```

`position.rects` 是 `[left, top, right, bottom]`，PDF pt 文档坐标系（存疑项 3 的翻转公式转成 EmbedPDF 的 top-left 页坐标）。

残余坑（[pitfall/](./pitfall/)）：02 sumPrecise polyfill、04 程序化选中不弹窗、07 image 标注膨胀、10 跨 realm Uint8Array、11 引擎就绪才能调。

## 适配层形态（和调研预期的差异）

- 引擎装配用 React headless：`usePdfiumEngine` + `<EmbedPDF>` provider + 每个插件的 `/react` 层组件（Viewport / Scroller / RenderLayer / SelectionLayer / AnnotationLayer / PagePointerProvider），不是 vanilla PluginRegistry 手搓。壳本来就是 React，这条更省。
- 命令式操作（setTool / navigate / zoom / spread / CRUD / select）从 `onInitialized(registry)` 里拿各插件 capability 的 `forDocument(docId)` scope 组装成一个 handle。
- spike 当时的结论：引擎必须直连（`worker: false`）且页面跨源隔离，否则加载静默卡死（pitfall 18）；这条已被 pitfall 21 的绝对 wasm URL 修法推翻，worker 引擎现在是默认，跨源隔离也不是必需。initialDocuments 不能用，要 init 后显式开（pitfall 19）。RenderLayer 要 `pointerEvents:none` 否则划词死（pitfall 20）。

## 跑起来的验证清单（全绿）

从字节渲染、导入已存批注、划词建高亮（带原文）、ink 拖画建注、宿主改色/改 comment、删除、点选批注、程序化跳批注、跳页、zoomIn/Out/fitWidth、单双页切换、viewState 重载还原。

## 没验证的

- iOS/WKWebView（无开发者账号）。
- WebKitGTK 拖选/手写延迟（pitfall 12）在 PDFium 渲染路径下的表现——需真机 Tauri，未跑（pitfall 14 OOM 顾虑）。
- 壳真机全链路：App 集成层（`EmbedReaderPane`）已接线并通过类型检查、开 flag 后 App 能正常启动到 Topics 库，但"打开书"要 Tauri `readFile`，未在纯浏览器里跑通开书后的完整交互；引擎本体交互已在 harness 里全测。
- ink 压感、highlight 精确页内滚动还原、点批注 popup 的精确视口锚点（当前用视口中心兜底，原生 `AnnotationLayer` 的 `selectionMenu` 是精确锚点路径）。

## 性能迭代（2026-07-16，真机 WebKitGTK 反馈"缩放和 AI 弹窗卡"后）

两处卡顿根因不同，分别处理。

AI 弹窗卡 = 同一棵 React 树的重渲染回归。老 zotero 引擎在 iframe 里，壳的 state 变化天然到不了引擎；换 EmbedPDF 后引擎和壳同树，AI 流式回复每秒几十次 setState 会把整个 EmbedPDF provider 子树跟着重渲。修法：`EmbedReaderPane` 套 `React.memo` + App 传给它的 handler 全部 `useCallback` 稳定。量化（Chromium，父组件 churn 60 次）：

| | 引擎子树重渲次数 |
|---|---|
| 修前（memo off） | 60 |
| 修后（memo on） | 0 |

缩放卡 = 整页重光栅化。原来 renderPage 直接用 `<RenderLayer>`，每变一档缩放就把整页按新 scale 重栅一遍。改成官方推荐的双层：base `<RenderLayer scale={1}>`（固定低清，只被 CSS 缩放）+ `<TilingLayer>`（只栅格可视区高清 tile）。实测缩放时 img 数量随可视 tile 增减（10↔12），不再整页重栅，seed 批注仍在。注意：这个卡顿是 WebKitGTK 合成路径特有（对比 pitfall 12），headless Chromium 复现不出来（zoom 一步 longtask 计数为 0），所以缩放这项只能给"改对了渲染策略"的定性结论 + tile 行为验证，给不出 WebKitGTK 下的前后毫秒数——要真机 tauri dev 才量得到（pitfall 14 OOM 顾虑没跑）。

worker 引擎（本想拿它把光栅化挪出主线程）当时实测在 openDocument 处永久挂起（25s 仍卡），根因是 wasm URL 传了根相对路径；pitfall 21 的绝对 URL 修法解决后 worker 引擎已转正为默认，直连降级为兜底。

指针路由：tiling 加了层后确认划词仍到 SelectionLayer（`elementFromPoint` 命中 pointerEvents:auto 的交互 div，不是 tile img）。live 拖选在 headless 下因 Playwright + 持续 tile 渲染的组合会把 `page.mouse` 卡住（工具侧假死，非应用问题），未在 tiling 下重跑 live 拖选；程序化建注/改/删、缩放、seed 渲染均在 tiling 下验过。

## 加载性能迭代（2026-07-16，真机反馈"开书偏慢"后）

在适配层埋 `performance.mark` 拆冷开书时间线（demo.pdf 14 页，headless Chromium）。发现：取字节→引擎 ready→openDocumentBuffer 解析→layout ready 全部在 ~270ms 内完成（引擎 create 90ms、解析 5ms、layout 到 268ms）；瓶颈在 layout ready 到首页可见的 ~1s 光栅化（PDFium 在主线程栅格可视 + buffer 页）。

三个根因，两个修了：

1. 引擎每次开书都重建。`usePdfiumEngine` 的 effect 挂载即 `createPdfiumEngine`（fetch+compile+init 4.6MB wasm）、卸载即 destroy；而 EmbedPdfView 每本书 remount，等于每次开书重付一遍 wasm 编译。改成应用级单例 `getPdfiumEngine()`（建一次、永不销毁），App 启动 `prewarmPdfiumEngine()` 预热，开书只在引擎上 open document。Chromium 里 wasm 编译才 ~90ms，省得不多；WebKitGTK 上 wasm 编译慢得多，且预热把它挪出了开书关键路径。

2. 屏外 buffer 页在首屏前就栅格。scroll 插件默认 `bufferSize: 2`（可视区上下各多渲 2 页），这些页在首页可见前就占着主线程栅格。调成 `bufferSize: 1`。首屏耗时（prod build）：

| bufferSize | 首页可见 |
|---|---|
| 2（默认，改前） | 1295ms |
| 1（改后） | 947ms |
| 0（更激进，供参考） | 649ms |

3. dev vs prod。用户跑 `tauri dev`。冷 dev 首次加载 2940ms，其中 ~1.6s 是 Vite 首次转译/加载整个插件依赖图的一次性开销；prod build 首屏 947ms（bufferSize:1），暖 dev（模块已缓存）也 ~929ms。即 dev 首开有一大截是 dev 模式独有、prod 没有的。

没帮上的：`encoderPoolSize`——这个测量当时在直连引擎下做的，而直连引擎根本不读这个选项（pitfall 139），结论作废；worker 引擎（现在的默认）下未测过。虚拟化是好的：14 页只渲可视附近 5-7 页，不是全渲。

对照组（回答"是不是本来就慢"）：zotero 引擎同一本 PDF，`createView` → `onInitialized` ~1020ms（dev）。即换 EmbedPDF 前基线也在 1s 量级。用户感到的"变慢"是真回归——改前 EmbedPDF 冷 dev 首开 2.9s（每次重建引擎 + 默认 buffer），修后 prod 947ms / 暖 dev 929ms，回到与 zotero 同量级甚至更快。

WebKitGTK 真机毫秒数没量（同缩放，pitfall 14 OOM 顾虑没跑 tauri dev）。埋点留在代码里（`window.__epdfPerf`，开销可忽略），真机可直接读。

## 阅读区排版（2026-08-03，"页面四周有留白、页与页之间一条灰带"）

留白只有一个来源：`Viewport` 组件把 viewport 插件的 `viewportGap` 当 `padding` 写在滚动容器上。它同时是 zoom 插件解 fit 的减数（`clientWidth - 2*gap`）和 scroll 插件每个页面滚动位置的加数——所以那 10px 不只是边距，还让"整页适配"比屏幕小 2×gap（坑 100）。页与页之间的灰带是 scroll 插件的 `defaultPageGap`（未缩放页单位，乘 scale 后既是 DOM 的 flex `gap` 也是 virtual items 的步长，坑 96），缝里露出的就是视口背景色。

改前后的实测数（demo.pdf，页 612×792；`spike-harness` + playwright 逐状态量页盒）：

| | 竖屏 834×1194 | 横屏 1194×834 |
|---|---|---|
| 改前 fit-width | 1.33，页宽 813.95，四周 10px | 1.918，页宽 1173.81 |
| 改前 fit-page（翻页） | 1.33，同上 | 1.027，页宽 628.52 |
| 改前页间距 | 13.3px（竖排与翻页同） | 19.18px / 翻页 10.27px |
| 改后 fit-width | 1.362，页宽 833.53，四周 0 | 1.95，页宽 1193.39 |
| 改后 fit-page（翻页） | 1.362，页宽 833.53 | 1.053，页宽 644.42 |

现在这几个数由 `src/reading/engine/page-frame.ts` 一处给出（有单测），两套取值：

- `hairline`：`pageGap 2`（竖屏 fit 下 2.72px）+ 每页 1px 描边 `0 0 0 1px rgba(15,23,42,.10)`，底色 `#dfe3e8`。两页之间是一条线。
- `float`：`pageGap 8`（10.9px）+ 每页投影 `0 1px 4px rgba(15,23,42,.22)`，底色 `#d5d9de`。纸浮在深一点的桌面上。

纸张底色和描边画在 `inset: 0` 的一层上，也就是页盒本身，所以标注层、选区层、tile 层的坐标一个像素都没动。验证方式是把种子高亮换算回未缩放页坐标：两种朝向、竖排/翻页、fit / 两级放大 / fit-width / 跳页 / 选中标注各状态下恒为 `(100, 130, 200, 12)`，最大偏差 0.009 页单位。`box-shadow` 不进滚动区，竖排下 `scrollWidth` 仍等于 `clientWidth`。
