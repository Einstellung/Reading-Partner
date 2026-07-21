# webview 的 CSP + COEP 双杀外链图片，靠 data: URL 内联

现象：每日速读的文章正文里，所有外链图片（`<img src="https://...">`）一律加载失败，只剩文字和破图图标。sanitize 明明保留了 http(s) 图片、还补了 `referrerpolicy="no-referrer"`，图还是不显示。

原因：webview 从两个方向拦外链图片，缺一不可绕。

1. `tauri.conf.json` 的 CSP `img-src 'self' data: blob:`——没有 `https:`，跨源图片直接被 CSP 拦。
2. 同处的响应头 `Cross-Origin-Embedder-Policy: require-corp`——PDFium WASM 引擎要跨源隔离才能跑（见坑 18），它会拦掉所有没带 CORP 头的跨源子资源，新闻 CDN 的图基本都不带。

这两条都不能松：CSP 放开 `img-src https:` 是安全倒退；COEP 一去掉 PDFium 就加载不了。所以外链图永远进不来。

解法：图片字节走 Tauri http 路由（和 `src/info/http.ts` 的 `infoFetch` 同一条 `cleanTauriFetch` 通道，webview 的 CSP/CORS 看不到它），拿到 bytes + content-type 后编码成 `data:<type>;base64,...` 换掉 `src`。data: 在 CSP 里是放行的。

- 纯逻辑在 `src/info/inline-images.ts`：抽外链 src、改写 src、编码 data URL、caps（每篇最多 30 张、单张超 5MB 跳过）。fetch 注入，可测。
- 文章视图 `ArticleView` 打开时先渲染缓存 HTML（文字立刻出），后台逐张内联，换好一张换一张，全部完成后把改写过的 HTML 写回当天的文章缓存（`store.ts` 的 `saveInlinedArticleHtml`），下次打开秒开且离线可用。
- pending 态：CSS `.info-article-body img[src^="http"] { display:none }` 把还没换成 data: 的外链图藏掉，不露破图图标；换成 data: 后规则不再命中，图自然显示。
- fetch 失败或超尺寸的图直接删掉（安静降级，不留破图）。
- 内联只改 `src` 的值，绝不重新引入属性——sanitize 仍是安全边界，内联跑在它之后。

相关：Rust 侧 fetch 不发 Referer，所以 sanitize 里那个 `no-referrer` 的防盗链考量在这条路由上本就不适用。
