# EmbedPDF 替换 spike 实测结果

2026-07-16。分支 `spike/embedpdf`。只做 PDF。桌面 + headless Chromium 实测，未测 iOS/WKWebView、未测 WebKitGTK 拖选延迟。

对应 `docs/07-EmbedPDF替换调研.md` 的存疑项 3-8，逐条给实测结论。验证靠 `embedpdf-spike.html` + `src/reader-embedpdf/spike-harness.tsx`（Vite dev 起，Playwright 驱动），批注转换器另有纯函数单测 `tests/reader-embedpdf-convert.test.ts`（`bun test`，9 pass）。

## 存疑项结论

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| 3 | 坐标系原点与 Y 翻转 | 成。EmbedPDF 页坐标是 top-left 原点（y 向下），zotero 是 PDF pt bottom-left。翻转公式 `embedY = pageH - zoteroYTop`，宽高不变。实测精确：zotero rect `[100,650,300,662]` 在 792pt 高页上 → segmentRect `origin{100,130} size{200,12}`（792-662=130），程序化建注反向也精确回到 `[90,658,330,672]`。 | 转换器单测 + harness dumpEmbed |
| 4 | viewState 精确还原 | 部分成。页码 + 缩放精确还原（请求 page=6 zoom=1.5，重开落在 pageIndex 6 / zoom 1.5）。页内精确 scrollTop 未做——`scrollToPage` 支持 `pageCoordinates{x,y}` 可做到，本 spike 只还原到页顶。 | harness URL 参数重载 |
| 5 | 程序化 scroll-to-annotation | 成。`selectAnnotation(pageIndex,id)` + `scrollToPage({pageNumber, pageCoordinates:{x,y}, alignY})`。实测从第 8 页跳到 seed 批注（第 1 页）落回 pageIndex 0。 | harness navigateToAnnotation |
| 6 | highlight 建注取原文 | 成，但 highlight 对象本身不存原文（`PdfHighlightAnnoObject` 无 text 字段，确认）。适配层在 `selection.onSelectionChange` 时缓存 `getSelectedText()`，建注事件里塞进 zotero.text。实测真拖选建高亮，带出原文 `"gal,brendan,...@mozilla.co"`。 | harness 真鼠标拖选 |
| 7 | custom 字段 round-trip | 成。text/tags/aiThreadId/starred/pageLabel/dateCreated 装进 `custom`（EmbedPDF `custom?: any` 透传），import→存→改色改 comment→仍在。 | 单测 + harness update 后 dump |
| 8 | openDocumentBuffer 吃字节 | 成。直接吃内存 ArrayBuffer 渲染，无临时文件。注意引擎 API 是 `openDocumentBuffer({id, content: ArrayBuffer})`，doc-manager 插件是 `{buffer: ArrayBuffer}`；类型都要 ArrayBuffer，Uint8Array 传 `.buffer`。 | harness 从 fetch 的 buffer 渲染 |

## 适配层形态（和调研预期的差异）

- 引擎装配用 React headless：`usePdfiumEngine` + `<EmbedPDF>` provider + 每个插件的 `/react` 层组件（Viewport / Scroller / RenderLayer / SelectionLayer / AnnotationLayer / PagePointerProvider），不是 vanilla PluginRegistry 手搓。壳本来就是 React，这条更省。
- 命令式操作（setTool / navigate / zoom / spread / CRUD / select）从 `onInitialized(registry)` 里拿各插件 capability 的 `forDocument(docId)` scope 组装成一个 handle。
- 引擎必须直连（`worker: false`）且页面跨源隔离，否则加载静默卡死（见 pitfall 18）。initialDocuments 不能用，要 init 后显式开（pitfall 19）。RenderLayer 要 `pointerEvents:none` 否则划词死（pitfall 20）。

## 跑起来的验证清单（全绿）

从字节渲染、导入已存批注、划词建高亮（带原文）、ink 拖画建注、宿主改色/改 comment、删除、点选批注、程序化跳批注、跳页、zoomIn/Out/fitWidth、单双页切换、viewState 重载还原。

## 没验证的

- iOS/WKWebView（无开发者账号）。
- WebKitGTK 拖选/手写延迟（pitfall 12）在 PDFium 渲染路径下的表现——需真机 Tauri，未跑（pitfall 14 OOM 顾虑）。
- 壳真机全链路：App 集成层（`EmbedReaderPane`）已接线并通过类型检查、开 flag 后 App 能正常启动到 Topics 库，但"打开书"要 Tauri `readFile`，未在纯浏览器里跑通开书后的完整交互；引擎本体交互已在 harness 里全测。
- ink 压感、highlight 精确页内滚动还原、点批注 popup 的精确视口锚点（当前用视口中心兜底，原生 `AnnotationLayer` 的 `selectionMenu` 是精确锚点路径）。

## 开关

`VITE_ENGINE=embedpdf`（环境变量）走 EmbedPDF，默认（不设）走 zotero iframe。见 `src/reader-embedpdf/engine-flag.ts`。zotero 路径未改动。

## 性能迭代（2026-07-16，真机 WebKitGTK 反馈"缩放和 AI 弹窗卡"后）

两处卡顿根因不同，分别处理。

AI 弹窗卡 = 同一棵 React 树的重渲染回归。老 zotero 引擎在 iframe 里，壳的 state 变化天然到不了引擎；换 EmbedPDF 后引擎和壳同树，AI 流式回复每秒几十次 setState 会把整个 EmbedPDF provider 子树跟着重渲。修法：`EmbedReaderPane` 套 `React.memo` + App 传给它的 handler 全部 `useCallback` 稳定。量化（Chromium，父组件 churn 60 次）：

| | 引擎子树重渲次数 |
|---|---|
| 修前（memo off） | 60 |
| 修后（memo on） | 0 |

缩放卡 = 整页重光栅化。原来 renderPage 直接用 `<RenderLayer>`，每变一档缩放就把整页按新 scale 重栅一遍。改成官方推荐的双层：base `<RenderLayer scale={1}>`（固定低清，只被 CSS 缩放）+ `<TilingLayer>`（只栅格可视区高清 tile）。实测缩放时 img 数量随可视 tile 增减（10↔12），不再整页重栅，seed 批注仍在。注意：这个卡顿是 WebKitGTK 合成路径特有（对比 pitfall 12），headless Chromium 复现不出来（zoom 一步 longtask 计数为 0），所以缩放这项只能给"改对了渲染策略"的定性结论 + tile 行为验证，给不出 WebKitGTK 下的前后毫秒数——要真机 tauri dev 才量得到（pitfall 14 OOM 顾虑没跑）。

worker 引擎（本想拿它把光栅化挪出主线程）实测在 openDocument 处永久挂起（25s 仍卡），根因见 pitfall 21，暂时走不通；直连引擎 + tiling 是当前落地路径。

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

没帮上的：`encoderPoolSize`（栅格瓶颈不是编码，实测 1298 vs 1282ms 无变化，已回退）；worker 引擎把栅格挪出主线程本是正解，但挂起走不通（pitfall 21）。虚拟化是好的：14 页只渲可视附近 5-7 页，不是全渲。

对照组（回答"是不是本来就慢"）：zotero 引擎同一本 PDF，`createView` → `onInitialized` ~1020ms（dev）。即换 EmbedPDF 前基线也在 1s 量级。用户感到的"变慢"是真回归——改前 EmbedPDF 冷 dev 首开 2.9s（每次重建引擎 + 默认 buffer），修后 prod 947ms / 暖 dev 929ms，回到与 zotero 同量级甚至更快。

WebKitGTK 真机毫秒数没量（同缩放，pitfall 14 OOM 顾虑没跑 tauri dev）。埋点留在代码里（`window.__epdfPerf`，开销可忽略），真机可直接读。
