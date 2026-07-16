# EmbedPDF 文档加载静默卡在 progress 0

现象：装配好 EmbedPDF core + PdfiumEngine + 插件，openDocumentBuffer 的 task resolve 了（返回 {documentId}），但 doc-manager 的 documentState 一直是 `status: "loading"`, `loadingProgress: 0`, `document: null`，页面永不渲染，控制台没有报错。

原因：两层。

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
