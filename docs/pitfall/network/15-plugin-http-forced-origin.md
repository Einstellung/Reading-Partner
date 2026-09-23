# Tauri http 插件强制补 Origin，Anthropic 视其为 CORS 请求

现象：M5 真机验收踩到（2026-07-13）。Anthropic 订阅 OAuth 请求经 Tauri http 插件发出，仍被服务端 401 拒：先是 "CORS requests are not allowed for this Organization"（SDK 的浏览器直连标记头所致），摘掉标记头后变成 "CORS requests must set 'anthropic-dangerous-direct-browser-access' header"——说明服务端仍把请求当 CORS 处理。

原因（插件源码 commands.rs 实锤）：tauri-plugin-http 默认**强制**给每个请求补 Origin 头（webview 的地址，如 http://localhost:1420）。Anthropic 只要看到 Origin 就按浏览器 CORS 规则处理，订阅组织直接拒。

解法（两处配套）：

1. Cargo.toml 给插件开 `unsafe-headers` feature——开了之后调用方提供的 Origin 优先，且**传空 Origin（""）= 插件删掉整个 Origin 头**（源码注释原话："Some services do not like Origin header"）。
2. fetch 桥对走 Rust 的请求统一：删掉 SDK 的 `anthropic-dangerous-direct-browser-access` 标记头 + `Origin` 置空。请求从此在服务端眼里是纯原生客户端。

关联坑：SDK 可能在模块加载时缓存原生 fetch，桥必须在 pi-ai 加载前安装（main.tsx 先安桥、动态 import App）。
