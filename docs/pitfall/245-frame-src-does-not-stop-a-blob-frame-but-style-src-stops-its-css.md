# `frame-src 'self'` 拦不住 blob: iframe，拦住的是它里面的 CSS 和字体，而且父页看不见违规

## 现象

按 docs/39 的判断，本仓库的 CSP 里 `frame-src 'self'` 会挡掉 blob: 的 iframe，所以要加 `blob:`。实测正好相反。

把现行 CSP 原样注进 harness（`meta http-equiv`，`epub-spike.html?csp=prod`），在 iOS 26.5 的 WKWebView（`tauri://localhost`）和 WebKitGTK 上各跑一遍：

| | frame 加载 | 里面的 blob 图 | 里面的 blob CSS | 里面的 blob 字体 |
|---|---|---|---|---|
| `frame-src 'self'` | 成功 | 成功 | **没生效** | **没加载** |
| `frame-src 'self' blob:` | 成功 | 成功 | 没生效 | 没加载 |
| 再给 `style-src`/`font-src` 加 `blob:` | 成功 | 成功 | 生效 | 加载 |

父页的 `securitypolicyviolation` 监听器全程一条都没收到。

## 原因

两件事撞在一起。

一，WebKit 对 blob: 这类 local scheme 的 frame 导航不按 `frame-src` 判。blob: URL 带的是造它的那个页面的 origin，WebKit 当自己人放行。Chromium 不是这么做的，所以这条只对 WebKit 成立——两个引擎都要过的话，`frame-src` 还是得写 `blob:`。

二，blob: frame 会**继承**父文档的 CSP，然后拿这份策略去判自己的子资源。`img-src` 本来就有 `blob:`（图能出），`style-src` 和 `font-src` 没有（CSS 和字体被拦）。违规发生在子文档里，事件也就派发在子文档上；父页装的监听器不在那棵树上，什么都收不到。子文档又是 `sandbox` 不带 `allow-scripts` 的（坑 244），里面根本没法装监听器。

## 解法

判断 blob 子资源有没有被拦，只能看效果，不能等违规事件：读 `contentDocument` 的 `getComputedStyle`（CSS 有没有生效）和 `document.fonts.size`（字体有没有加载）。`epub-spike.html` 的探针就是这么写的。

EPUB 渲染要放行的是三项，不是一项：`frame-src`、`style-src`、`font-src` 都加 `blob:`。见 docs/62。
