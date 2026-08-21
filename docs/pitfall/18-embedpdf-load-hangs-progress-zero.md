# EmbedPDF 文档加载静默卡在 progress 0

现象：装配好 EmbedPDF core + PdfiumEngine + 插件，openDocumentBuffer 的 task resolve 了（返回 {documentId}），但 doc-manager 的 documentState 一直是 `status: "loading"`, `loadingProgress: 0`, `document: null`，页面永不渲染，控制台没有报错。

原因（当时的判断，第 1 条已被推翻，见文末）：

1. PDFium wasm 是 pthread 构建，需要 `SharedArrayBuffer`；浏览器只在跨源隔离（cross-origin isolated）的页面给。dev server 默认不发 COOP/COEP，`self.crossOriginIsolated === false`，`SharedArrayBuffer` 不存在，PDFium 线程起不来，解析就挂着不动。
2. `usePdfiumEngine()` 默认走 worker 引擎。worker 引擎在本 spike 的 dev + COEP 组合下也挂（worker 资产被 COEP 拦或起不来）。直连（主线程）引擎正常。

解法：

- dev server 发跨源隔离头：
  ```ts
  server: { headers: {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  } }
  ```
- 引擎用直连模式：`usePdfiumEngine({ wasmUrl, worker: false, fontFallback: null })`。

定位手法：用底层 `createPdfiumDirectEngine('/pdfium/pdfium.wasm').openDocumentBuffer({id, content})` 直接开文档，绕过整个插件系统。若这条能出 pageCount，就是插件/引擎模式/隔离问题，不是 wasm 本身。

iOS/WKWebView 上跨源隔离与引擎模式要另测，这里的结论只覆盖桌面 dev + headless Chromium。

## 归因更正：PDFium 不需要 SharedArrayBuffer

"需要 SAB / 需要跨源隔离"是错的。实测 `@embedpdf/pdfium` 2.14.4 的 pdfium.wasm 根本不是 pthread 构建：import 段 37 项全是函数、没有 memory import，memory 在自己的 section 里声明 `shared=false`，二进制里 `pthread` 字符串 0 处，glue 里 `SharedArrayBuffer`/`PThread` 各 0 处——pthread 构建必须从 JS import 一块 shared memory，这个不是。没有 SAB 时它也不"退化成单线程"，它本来就只有单线程（坑 33、坑 21）。

worker 引擎那次挂的是根相对的 wasmUrl：blob: 基址解不了根相对路径，fetch 抛错又被 post 成主线程不认的消息类型，于是永久等待，和跨源隔离无关（坑 21）。跨源隔离关掉、`SharedArrayBuffer` 不存在时，Chromium、WebKitGTK、macOS WKWebView 上 worker 引擎都能正常开文档。

解法那两条留着：跨源隔离头无害（`vite.config.ts` 和 `tauri.conf.json` 里都还在，注释仍写着旧理由），将来引 SAB 的东西也用得上；直连引擎则是坑 21 的兜底路径。但不要再拿"需要 SAB"去解释任何新现象。

