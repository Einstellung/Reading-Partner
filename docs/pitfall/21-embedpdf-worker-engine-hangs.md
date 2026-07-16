# EmbedPDF worker 引擎在 openDocument 处永久挂起

现象：`usePdfiumEngine({ worker: true })`（也是默认值）下，引擎工厂 resolve 了、blob worker 也建出来了，但第一次 `openDocumentBuffer` 的 task 永不 resolve（实测 25s 仍卡，不是慢，是挂）。同一份 wasm、同一页面（跨源隔离已开、SharedArrayBuffer 有），直连引擎 `worker: false` 正常出 14 页。

排查已排除的：
- 不是 COEP 挡 worker：同源 blob module worker 能起能通信（postMessage 往返正常）。
- 不是 SharedArrayBuffer：`crossOriginIsolated === true`，SAB 存在。
- 不是慢启动：8s、25s 两档都挂。

原因（推断，未逐字验证到 PDFium glue）：EmbedPDF 的 worker 引擎把整个 worker 脚本内联成 `URL.createObjectURL(new Blob([...]))` 的 blob module worker。PDFium 是 Emscripten pthread 构建，在 worker 里跑时要再 spawn pthread 辅助 worker，Emscripten 用 `new Worker(new URL(..., import.meta.url))` 解析辅助 worker 路径；在 blob worker 里 `import.meta.url` 是 `blob:` URL，没有可解析的 base path，嵌套 pthread worker 建不出来，PDFium pthread init 一直等，openDocument 就永远不返回。

解法（当前）：用直连引擎 `usePdfiumEngine({ worker: false })`，PDFium 跑主线程。代价是光栅化占主线程——靠 tiling（base RenderLayer 固定 scale=1 只做 CSS 缩放 + TilingLayer 只栅格可视 tile）把缩放时的主线程重光栅化降下来，别整页重栅。

未试的路子（将来要 worker offload 再走）：文档里 `new Worker(new URL('./webworker.ts', import.meta.url), { type:'module' })` + `new WebWorkerEngine(worker)` 这条——让 Vite 把 worker 打成正经 chunk（`import.meta.url` 是真 http URL，嵌套 pthread worker 能解析），大概率绕过 blob 的问题。但 `WebWorkerEngine(worker, logger)` 构造不收 wasmUrl，自托管 wasm 怎么喂进去要再查。
