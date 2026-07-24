# iOS WKWebView 自定义协议下没有跨源隔离，但 PDFium 直连引擎照样渲染

现象：在真实 iPad 模拟器（WKWebView，Tauri `tauri://` 自定义协议）跑引擎冒烟，`self.crossOriginIsolated === false`、`typeof SharedArrayBuffer === "undefined"`，可 EmbedPDF 直连引擎仍然 openDocumentBuffer + renderPage 成功，渲染出正确页面（200×200，18240 非白像素；engineReady 256ms / open 12ms / render 730ms）。截图与 fixture 完全一致。

原因：`tauri.conf.json` 的 `app.security.headers`（COOP=same-origin / COEP=require-corp）在桌面 WebKitGTK 和生产 webview 能让页面跨源隔离，坑 18 就靠它拿到 SharedArrayBuffer。iOS WKWebView 对自定义 scheme 的响应不据此授予 `crossOriginIsolated`，SAB 不存在。但 `@embedpdf/pdfium` 2.14.4 的直连（主线程）引擎在没有 SAB 时不挂起——退化成单线程 PDFium，解析和光栅化照常。渲染正确性不依赖 SAB，只是多线程加速用不上。这和坑 18/21 里 desktop 上"没 SAB 就静默卡 progress 0"是不同引擎路径（那是 worker/pthread 引擎）。

结论：

- iOS 继续用直连引擎（`engine-singleton` 已是 `createPdfiumEngine`，worker:false 等价），不要在 iOS 试 worker 引擎。
- 不必为 iOS 折腾让 COOP/COEP 生效，渲染不需要。但 COEP=require-corp 仍会拦跨源子资源，坑 30 的外链图 http 路由内联在 iOS 同样需要（本冒烟未覆盖，iPad 适配时验证）。
- 闸门可以在模拟器上无签名验证，不需要第一个 TestFlight 包——推翻 docs/11 的旧结论。链路见 `.github/workflows/ios-simulator-smoke.yml` 和 `src/smoke/`。

遗留风险：若将来升级 `@embedpdf` 且新版直连引擎硬依赖 SAB，iOS 会退回坑 18 的静默挂起；冒烟的 `failLayer` 会标 `document-open` 或 `no-cross-origin-isolation`，据此定位。`minimumSystemVersion` 现为 16.0，WebKit 的 SAB 要 16.4，但既然 iOS 根本没启用隔离、渲染也不靠它，此处不阻塞；将来若要多线程 SAB，得同时解决自定义协议隔离 + 抬到 16.4。

验证手法（simctl 链路，供复现）：`tauri ios build --target aarch64-sim --no-sign` 出 `.app`（非 ipa、跳签名，需 Apple Silicon runner）→ `simctl list devices available -j` 选现成 iPad → `bootstatus -b` → install/launch → 结果 JSON 写在 app 数据容器。`BaseDirectory.AppData` 在 iOS 的具体落点不确定，CI 按唯一文件名 `find` 而不是硬编码路径。
