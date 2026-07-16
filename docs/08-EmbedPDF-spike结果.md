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
