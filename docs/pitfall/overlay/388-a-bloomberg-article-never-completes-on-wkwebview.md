# 同一篇彭博文章在 WKWebView 上永远到不了 complete

## 现象

macOS 上取正文必定超时：`no load event within 45s`。可页面本身是好的——
用页探针（不等加载事件，到点就读）看，标题、`<article>`、正文全在。

2026-09-22 同一个 URL、同一小时、同一条网络，两台机器对比：

| 引擎 | 结果 | `document.readyState` | 用时 | `body.innerText` |
|---|---|---|---|---|
| WebKitGTK 2.52（Linux） | ok | complete | 18.9s | 1702 |
| WKWebView（macOS 26.5） | timeout | interactive | 45.0s（超时） | 2252 |

macOS 那次拿到 679 KB html、正确的标题、一个 `<article>`。正文是匿名读者那份
预览，不是验证码。

同一个站的登录页（`/account/signin`）在 macOS 上 8.3s 就 `Ok`，所以这不是
"彭博在 WKWebView 上过不去"，是文章页这一类。

## 原因

`LoadEvent::Finished` 在 macOS 上来自 wry 的 `didFinishNavigation`，而那个方法要
文档真的读完。文章页有东西一直不结束，`readyState` 停在 `interactive`，
`didFinishNavigation` 就不来。WebKitGTK 上同一个页面 18.9 秒到 `complete`。

wry 的导航代理又没实现 `didFail…` 那一系列，所以失败和"还在加载"在 macOS 上长得
一模一样（见 `connect_engine_signals` 的 macOS 那半）。

## 解法

文章页和 page 不再只等加载事件。等待里每 500ms 问一次文档自己（`ready.js`：
`document.readyState` 加 `document.body.innerText.length`），`readyState` 到
`interactive` 且已渲染的正文不少于 200 字就进 settle 循环，和收到 `finished`
一样（`policy::has_begun`，`mod.rs` 的 `wait_for_load`）。settle 判据一个字没改：
正文长度连续四次不变才停。

两个条件都要，因为两种误判都真会发生：只看 `readyState` 会在空文档上开读，
`Phase::Page` 只要"不再变化"，空的也算不再变化；只看正文长度会在还在解析的
文档上开读。

Linux 照旧只等事件——探针在那边永远返回 `None`，一次求值都不发。WebKitGTK
两种事件都报，加探针只会给一条本来就好使的路子加钱。

实测（2026-09-22，Mac mini，macOS 26.5，彭博 `fed-s-collins-says-rate-hike…`）：
文章页 1.0s 就 `interactive` 带 1714 字，整条 42.5s 返回 `ok`、正文 525 字符，
其中 38.4s 是冷罐首页暖机。改之前是 45s 超时，零字。第二篇（暖机 17.4s）整条
22.1s、正文 500 字符。

Linux 对照（同一台机器，同一个二进制的前后两版，各自冷 profile，xvfb）：

| URL | 改之前 | 改之后 |
|---|---|---|
| en.wikipedia.org/wiki/Portable_Document_Format | 12.86s，ok，35169 字符 | 12.92s，ok，35169 字符 |
| example.com | 30.91s，empty | 30.98s，empty |
| bing.com/images/search?q=cat | 37.68s，empty | 37.45s，empty |
