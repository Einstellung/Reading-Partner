# webview 的 CSP + COEP 双杀外链图片，靠自定义 URI scheme 代理

现象：每日速读的文章正文里，所有外链图片（`<img src="https://...">`）一律加载失败，只剩文字和破图图标。sanitize 明明保留了 http(s) 图片、还补了 `referrerpolicy="no-referrer"`，图还是不显示。

原因：webview 从两个方向拦外链图片，缺一不可绕。

1. `tauri.conf.json` 的 CSP `img-src 'self' data: blob:`——没有 `https:`，跨源图片直接被 CSP 拦。
2. 同处的响应头 `Cross-Origin-Embedder-Policy: require-corp`——PDFium WASM 引擎要跨源隔离才能跑（见坑 18），它会拦掉所有没带 CORP 头的跨源子资源，新闻 CDN 的图基本都不带。

这两条都不能松：CSP 放开 `img-src https:` 是安全倒退；COEP 一去掉 PDFium 就加载不了。所以外链图永远进不来。

解法：Rust 侧注册 `img:` 自定义 URI scheme（`src-tauri/src/image_proxy.rs`，`register_asynchronous_uri_scheme_protocol`），handler 用 reqwest 取原图、原样回放字节，响应头带 `Cross-Origin-Resource-Policy: cross-origin`——这条正是 COEP 要看的。CSP 相应放开 `img-src ... img: http://img.localhost https://img.localhost`（scheme 在 macOS/iOS/Linux 是 `img://localhost/<payload>`，在 Windows/Android 是 `http://img.localhost/<payload>`，两种形态都要覆盖）。

- 改写在渲染时，不在持久化时：`src/platform/app/image-proxy.ts` 的 `articleHtmlForWebview` 把 `<img src>` 换成 `convertFileSrc(url, "img")`（不要自己拼 URL，形态按平台不同），两个文章视图（`ArticleView`、`SavedArticleView`）各在 `useMemo` 里调一次。存下去的 HTML 保持原始 https URL，所以当天缓存和收藏记录都很小，收藏的文章现在有图。
- 非 Tauri 环境（bun dev、单测）没有这个 protocol，`proxyImageUrl` 返回 null，src 原样不动。
- handler 是全应用唯一由第三方 markup 驱动的出站请求，收得很紧：只认 GET/HEAD、只认绝对 http/https、拒 loopback/私网/link-local（重定向每一跳都重查）、content-type 必须是图片（上游没标就按 magic bytes 嗅探，都不是就 415）、5MB 硬上限（分块读，没有 Content-Length 也不会无界缓冲）。请求带浏览器 User-Agent、不发 Referer。
- 改写只动 `src` 的值，绝不重新引入属性——sanitize 仍是安全边界，改写跑在它之后。
- 加载失败（代理拒绝、上游挂了、不是图片）没有 CSS 可以命中，sanitize 又不能加 `onerror`，所以两个视图在容器上绑一个 capture 阶段的 error handler（error 不冒泡但会 capture），`hideBrokenImage` 把那个 img 藏掉。
- CSP 保留 `data:`：换 protocol 之前写进当天缓存的 base64 HTML 还要能渲染。`stripDataImages` 也保留，挡的是页面自带的内联图和这批老缓存进入会同步的收藏记录。

没验证过的：iOS 上自定义 protocol 的实际行为（WKURLSchemeHandler + COEP 的组合只在文档层面成立，没上过设备）。
