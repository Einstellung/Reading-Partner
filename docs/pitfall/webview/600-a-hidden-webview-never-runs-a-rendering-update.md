# 隐藏 webview 里的页面视口是 0×0，也从不跑渲染更新

## 现象

`webview_fetch` 的隐藏窗口（`visible(false)`，从不 show）里开页面，页内量到（WebKitGTK 2.52，Xvfb，2026-10-14）：

| 量 | 值 |
|---|---|
| `innerWidth`、`innerHeight`、`documentElement.clientWidth/Height`、body 宽 | 全是 0 |
| `document.visibilityState`、`document.hidden`、`hasFocus()` | `hidden`、true、false |
| `requestAnimationFrame` 2 秒内回调次数 | 0 |
| `IntersectionObserver`（连 observe 时那一次也算）、`ResizeObserver` | 一次都不回调 |
| `window.scrollBy(0, 800)` 之后 | `scrollY` 变成 800，但 `scroll` 事件一次都没发 |
| `setInterval(…, 100)` 2 秒 | 7 到 9 次（被节流，但在跑） |
| 手动 `dispatchEvent(new Event("scroll"))` | 监听器收得到 |

取正文和读永久链接页一直没出事，因为那只读 DOM 里已有的文字。靠滚动往下加载的列表（X 搜索页）要的正是这几样：视口有高度、滚动事件、IntersectionObserver 或 rAF。

## 原因

GTK 不给从未映射的窗口分配尺寸，WebKitGTK 按控件分配的大小定视口，于是是 0×0。页面可见性跟着控件是否映射走，不可见的页面 WebKit 不调度渲染更新，而 rAF、两种 Observer 的回调和真滚动事件都在渲染更新那一步里派发。

## 解法

视口：`browse.rs` 建窗后对 WebKit 控件手动 `realize()` + `size_allocate(1440×900)`，实测 `innerHeight` 变 900、页面按 1440 宽排版。可见性和渲染更新不变，rAF 和 IntersectionObserver 仍然 0 次。

渲染更新还没解。手动派发的 scroll 事件能到监听器，`scripts/x-search-probe.ts` 默认在每次小步滚动后派发一个，看 X 的加载靠不靠它；靠 IntersectionObserver 的话还得另想办法（页内垫一层 rAF/IO 的替身，或换一个能真渲染的宿主）。macOS 的隐藏 WKWebView 保留窗口尺寸，渲染更新会不会停没测过。

*实测：2026-10-14*
