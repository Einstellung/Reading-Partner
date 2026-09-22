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

还没做。暖机那半已经不看加载事件了（`jar.rs`：看 cookie 罐不再变化），文章那半
还在 `wait_for_load` 上等一个不会来的事件。要修就是同一个办法：
`Phase::Article` 在 macOS 上也得有个不靠加载事件的判据（`policy.rs` 的
`Readout`/`settle` 已经能回答"正文不再变化了"，缺的是允许它在没有 `finished`
的情况下开始问）。

在那之前，macOS 上取正文只对首页会报 `finished` 的站管用；`RP_WEBVIEW_PAGE_PROBE`
不受影响，它到点就读。
