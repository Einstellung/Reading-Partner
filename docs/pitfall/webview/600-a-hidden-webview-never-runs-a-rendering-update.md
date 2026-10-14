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

GTK 不给从未映射的窗口分配尺寸，WebKitGTK 按控件分配的大小定视口，于是是 0×0。页面可见性跟着控件是否映射走，不可见的页面 WebKit 不调度渲染更新，而 rAF、两种 Observer 的回调和真滚动事件都在渲染更新那一步里派发。手动 `realize()` + `size_allocate(1440×900)` 能治好视口，治不了可见性。

## 解法

浏览会话（`browse.rs` 的 `render_unseen`）把 WebKit 控件从 Tauri 的隐藏窗口里摘出来，放进一个 `GtkOffscreenWindow` 再 `show_all()`。离屏窗口是 GTK 自己在内存里画的顶层窗口，不交给 X11 或 Wayland，所以不上任何屏幕、不进任务栏、不拿焦点；控件算已映射，页面就是 `visible`，视口按 `set_size_request` 给的 1440×900。Tauri 窗口销毁时 wry 销毁控件，控件的 `destroy` 信号顺手销毁离屏窗口（实测关会话后触发）。

几种「人看不见但真在渲染」的办法，用本地测试页（哨兵元素进视口就追加 20 条）在 Xvfb 下比过，WebKitGTK 2.52：

| 办法 | rAF | IO / 无限加载 | RO | scrollBy 后的 scroll 事件 | visibilityState | 显示服务器上的可见窗口 |
|---|---|---|---|---|---|---|
| 隐藏窗口 + 手动 `size_allocate`（原做法） | 0 | 0，停在 20 条 | 0 | 0/6 | hidden | 无 |
| show 到 (-10000, -10000)，skip_taskbar、不可聚焦、不抢焦点（有无边框一样） | 在跑 | 在跑，20→60 | 在跑 | 6/6 | visible | 有，1440×900 在屏幕外 |
| 1×1 窗口放 (0, 0) | 在跑 | 在跑 | 在跑 | 6/6 | visible | 有，1×1；页面视口也是 1×1 |
| 透明（opacity 0）放 (0, 0) | 在跑 | 在跑 | 在跑 | 6/6 | visible | 有，1440×900，`hasFocus()` 为 true |
| `GtkOffscreenWindow`（新建，或从隐藏窗口挪进去） | 在跑 | 在跑，20→60 | 在跑 | 6/6 | visible | 无 |

屏幕外坐标在 Wayland 上做不到（客户端不能给窗口定位），透明靠合成器、窗口照样挡鼠标，所以用离屏窗口。`WEBKIT_DISABLE_DMABUF_RENDERER=1`、`WEBKIT_DISABLE_COMPOSITING_MODE=1` 下离屏窗口结果相同。app 本体里实测（调试包，Xvfb，`RP_WEBVIEW_BROWSE_PROBE` 把测试页写进会话的空白页）：rAF 约每秒 100 次，6 次 `scroll` 每次 0.9 屏，列表 20→60 条、文档高 2401→7201，`hasFocus()` 为 false，Xvfb 上没有一个可见窗口。只在 Xvfb 上量过：真 GPU 的 X11 桌面和 Wayland 会话没跑过。

`scripts/x-search-probe.ts` 原来在每次小步滚动后手动派发 scroll 事件，现在默认不派，`--synthetic-scroll` 打开。

macOS 未实测，`render_unseen` 的 macOS 分支是照 API 写的，没编译过也没跑过。做法：窗口改成无边框（AppKit 只把有标题栏的窗口拉回屏幕内），挪到 (-20000, -20000)，不接鼠标，集合行为设 Transient 和 IgnoresCycle，不进 Window 菜单，`orderBack:` 放进窗口列表但不成为 key 窗口，再用 WebKit 私有的 `_setWindowOcclusionDetectionEnabled:` 关掉这个 WKWebView 的遮挡判定。已知风险：

- 遮挡判定：屏幕外的窗口 `occlusionState` 不含 Visible，WKWebView 按隐藏页处理。只靠那个私有方法绕开，哪天它没了（`respondsToSelector:` 为假就不调），页面又回到隐藏。
- 不在任何屏幕上的窗口没有 display，WebKit 的 rAF 跟着显示器的 display link 走，可能照样不跑。
- App Nap：app 的窗口全被挡住或最小化、用户又不在用它时，系统会节流整个进程的定时器和渲染。`keep_awake` 的 IOPM 断言只防系统睡眠，不防 App Nap；要防得在会话期间 `NSProcessInfo beginActivityWithOptions:`，现在没加。
- 多屏排布的屏幕坐标覆盖到 (-20000, -20000) 时窗口会出现在那块屏上。

在 Mac 上验：同一张测试页按上面的办法跑一遍，看 rAF、IO 和 `visibilityState`，同时看屏幕、Dock、调度中心（Mission Control）和 Cmd+` 里都没有这个窗口。

*实测：2026-10-14*
