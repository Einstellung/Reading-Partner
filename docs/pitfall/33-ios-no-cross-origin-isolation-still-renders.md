# iOS WKWebView 自定义协议下没有跨源隔离，但 PDFium 直连引擎照样渲染

现象：在真实 iPad 模拟器（WKWebView，Tauri `tauri://` 自定义协议）跑引擎冒烟，`self.crossOriginIsolated === false`、`typeof SharedArrayBuffer === "undefined"`，可 EmbedPDF 直连引擎仍然 openDocumentBuffer + renderPage 成功，渲染出正确页面（200×200，18240 非白像素；engineReady 256ms / open 12ms / render 730ms）。截图与 fixture 完全一致。

原因：`tauri.conf.json` 的 `app.security.headers`（COOP=same-origin / COEP=require-corp）在桌面 WebKitGTK 和生产 webview 能让页面跨源隔离，坑 18 就靠它拿到 SharedArrayBuffer。iOS WKWebView 对自定义 scheme 的响应不据此授予 `crossOriginIsolated`，SAB 不存在。但 `@embedpdf/pdfium` 2.14.4 的直连（主线程）引擎在没有 SAB 时不挂起——退化成单线程 PDFium，解析和光栅化照常。渲染正确性不依赖 SAB，只是多线程加速用不上。这和坑 18/21 里 desktop 上"没 SAB 就静默卡 progress 0"是不同引擎路径（那是 worker/pthread 引擎）。

结论：

- 渲染不依赖 SAB。（当时写的是"iOS 继续用直连引擎，不要试 worker 引擎"，已推翻：worker 引擎同样不需要 SAB，见坑 21。在 macOS WKWebView 的 `tauri://localhost` 下实测 `engineMode: "worker"`、`crossOriginIsolated: false`、渲染 18240 非白像素。iOS 真机未验，`engine-singleton.ts` 起不来就退回主线程。）
- 不必为 iOS 折腾让 COOP/COEP 生效，渲染不需要。但 COEP=require-corp 仍会拦跨源子资源，坑 30 的外链图 http 路由内联在 iOS 同样需要（本冒烟未覆盖，iPad 适配时验证）。
- 闸门可以在模拟器上无签名验证，不需要第一个 TestFlight 包——推翻 docs/11 的旧结论。链路见 `.github/workflows/ios-simulator-smoke.yml` 和 `src/smoke/`。

2.14.4 的 pdfium.wasm 根本不是 pthread 构建（二进制里没有 memory import、没有 pthread 字符串），所以"没 SAB 就退化成单线程"这句话也不准确——它本来就只有单线程。SAB 与这条链路无关。冒烟结果里的 `engineMode` 记的是实际跑起来的引擎。

验证手法（simctl 链路，供复现）：`tauri ios build --target aarch64-sim --no-sign` 出 `.app`（非 ipa、跳签名，需 Apple Silicon runner）→ `simctl list devices available -j` 选现成 iPad → `bootstatus -b` → install/launch → 结果 JSON 写在 app 数据容器。`BaseDirectory.AppData` 在 iOS 的具体落点不确定，CI 按唯一文件名 `find` 而不是硬编码路径。
