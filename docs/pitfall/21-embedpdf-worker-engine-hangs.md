# EmbedPDF worker 引擎拿根相对 wasmUrl 会永久挂起

现象：worker 引擎（`usePdfiumEngine({ worker: true })`，也是默认值）下引擎工厂 1-4ms 就返回、blob worker 也建出来了，但第一次 `openDocumentBuffer` 的 task 永不 resolve（8s、25s 两档都挂，不是慢）。控制台一行都没有。同一份 wasm、同一页面，直连引擎正常出 14 页。

原因：wasmUrl 传的是根相对路径 `/pdfium/pdfium.wasm`。worker 引擎把整个 worker 源码内联成 `blob:` URL 的 module worker，worker 里 `fetch(wasmUrl)` 的 base 是那个 blob: URL——blob: 是不透明路径，根相对路径无 base 可解，fetch 直接 throw（WebKit 报 `URL is not valid or contains user credentials`）。worker 捕获后 post 一条 `{type:"wasmError"}`，这条消息**没有 id**；主线程 `RemoteExecutor.handleMessage` 只特判 `type === "ready"`，其余按 `pendingRequests.get(response.id)` 查，查不到就打条 debug 日志返回。`readyTask` 既不 resolve 也不 reject，之后每个 `send()` 都卡在 `readyTask.wait()` 里。engine 的 Worker 也没挂 `onerror`（唯一那个在 encoder pool 上）。所以没有任何东西可以 catch，只能靠超时发现。

解法：wasmUrl 传绝对地址，用 `location.href` 而不是 `location.origin` 当 base——自定义协议下 origin 有可能序列化成字符串 `"null"`，`new URL(path, "null")` 会抛。

```ts
new URL("/pdfium/pdfium.wasm", location.href).href
```

`src/reading/engine/engine-singleton.ts` 就是这么拼的，并且拿到引擎后先开一个内建的一页 PDF 再关掉（`engine-start.ts`），15s 没答话就销毁 worker 回退到直连引擎——这条路上没有报错这种东西，超时是唯一的探测手段。

原来这份文档把原因归到 Emscripten pthread：说 PDFium 在 worker 里要用 `new Worker(new URL(..., import.meta.url))` spawn 辅助 worker，blob 基址下解析不出来。整段是错的，两处都能证伪：

- 2.14.4 的 pdfium.wasm 不是 pthread 构建。import 段 37 个全是函数、没有 memory import；memory 在自己的 section 5 里声明（`shared=false`）；二进制里 `pthread` 字符串 0 处；glue 里 `SharedArrayBuffer`/`PThread` 各 0 处。pthread 构建必须从 JS import 一块 shared memory，这个不是。
- 那 675k 字符的内联 worker 源码里 `new Worker` 出现 0 次。

顺带：worker 引擎实际起 3 个 blob module worker——PDFium 一个，`ImageEncoderWorkerPool` 默认 `encoderPoolSize ?? 2` 两个。

实测覆盖：

- Chromium 和真 WebKit（Playwright webkit-2336，Linux 上就是 WebKitGTK）都验过：跨源隔离关掉、`SharedArrayBuffer` 不存在时 worker 引擎照样开 14 页。
- Tauri 打包（`tauri build --debug --no-bundle`）后在 macOS WKWebView 上跑 `VITE_SMOKE=1` 的冒烟：`location.origin` 是 `tauri://localhost`（不是 `"null"`），拼出的 `tauri://localhost/pdfium/pdfium.wasm` 被 blob worker 里的 fetch 取到了，`engineMode: "worker"`，`crossOriginIsolated: false`，渲染出 18240 非白像素。自定义协议下 worker 的 fetch 能到 WKURLSchemeHandler、CSP 的 `connect-src 'self'` 也匹配，这两条在 macOS 上是实测结论。
- iOS 真机/模拟器没验。iOS 和 macOS 共用 WKWebView 和同一份 Tauri 协议实现，但内存压力下 worker 被回收之类的差异只有真机能答；`.github/workflows/ios-simulator-smoke.yml` 的冒烟结果里有 `engineMode`，看那一栏。
