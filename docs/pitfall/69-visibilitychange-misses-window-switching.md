# visibilitychange 看不见桌面上的切窗口，焦点还会回弹

## 现象

把"回到前台立刻同步"挂在 `visibilitychange` 上，桌面上最常见的离开方式——切到别的窗口再切回来——一次都不触发。整个过程里 `document.visibilityState` 一直是 `visible`，事件根本没发。只有最小化和窗口被 unmap 才翻成 `hidden`。

## 原因

页面可见性描述的是"这个页面还在不在屏幕上被画"，不描述焦点。别的窗口盖上来或抢走焦点，这个页面仍然是可见的。

WebKitGTK 2.52.3（Tauri 在 Linux 用的 webview）实测：

| 动作 | 收到的事件 |
|---|---|
| iconify（最小化） | `blur` + `visibilitychange`（hidden=true） |
| deiconify（还原） | `focus` + `visibilitychange`（hidden=false），focus 在前 |
| 另一个窗口抢焦点 | 只有 `blur`，`visibilitychange` 不发 |
| 窗口 hide（unmap） | `visibilitychange` + `blur` |
| 导航走 | `pagehide`，随后 `visibilitychange`（hidden=true） |

两个附带结论：`visibilitychange` 在 document 上派发但冒泡到 window，只监听 window 拿得到（实测）；`present()` 之后一秒左右窗管理器可能再补一个 `blur`，焦点回弹，所以事件序列不是干净的一进一出。

iOS WKWebView 没实测——本机没有 macOS 也没有模拟器。

## 解法

把"在前台"当成一个状态而不是一个事件：可见且有焦点，由 `visibilitychange` / `focus` / `blur` / `pagehide` 四个事件共同维护，只在状态翻转时通知一次（`src/platform/app/lifecycle.ts`）。最小化同时发 blur 和 visibilitychange，调用方只听到一次。

因为焦点会回弹，两侧的代价都要算：离开那一侧必须便宜（同步引擎先看本地有没有改动，没有就一个请求都不发），回来那一侧必须有下限（30 秒内不重复跑 pass）。

把 blur 算成离开对同步是对的，对后台采集是错的：桌面机窗口最小化摆一边正是它该采集的时候。同一个文件里另出一个只听 `pagehide` 的 `observeAppExit`，采集的定时器挂那上面（docs/36）。
