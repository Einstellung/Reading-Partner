# iOS 上 Rust 发的请求不走系统 HTTP 代理

现象：2026-09-26，iPad（大陆网络）同步两天不动，Settings 里是 `error sending request for url (https://www.googleapis.com/drive/v3/files?…)`；同一台 iPad 上 Safari、webview 能上 Google 并不能说明 Rust 这条路也通。

原因（源码实锤，未上真机量）：所有 `cleanTauriFetch` / `@tauri-apps/plugin-http` 的请求由 Rust 里的 reqwest 0.12 发。reqwest 的系统代理读取在 hyper-util 0.1.20 `client/proxy/matcher.rs` 的 `Builder::from_system()`：先读 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 环境变量，再只在 `target_os = "macos"`（SCDynamicStore）和 `windows`（注册表）上读系统设置。iOS 不在里面，iOS app 也没有这些环境变量，所以 Wi-Fi 里手填的 HTTP 代理、代理 app 只下发代理设置（不接管全部流量）的模式，对我们的请求都不存在。WKWebView、Safari 走 CFNetwork，读得到。VPN/TUN 模式在 IP 层接管，对 reqwest 透明，不受影响。tauri-plugin-http 的 `system-proxy` / `macos-system-configuration` feature 在 iOS 上同样什么都不读。

解法：代理 app 用 VPN/TUN（全局接管）模式。要让 app 自己认 iOS 系统代理，得在原生侧调 `CFNetworkCopySystemProxySettings()` 取 `HTTPSProxy`/`HTTPSPort`（或按 URL 调 `CFNetworkCopyProxiesForURL` 处理 PAC），再经 plugin-http fetch 的 `proxy` 选项（`ClientOptions.proxy`）逐请求传进去；没有现成开关。
