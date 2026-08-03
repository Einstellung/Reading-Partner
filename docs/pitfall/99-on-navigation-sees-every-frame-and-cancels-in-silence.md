# `on_navigation` 收的是所有 frame 的导航，取消掉不留任何痕迹

## 现象

导航拦截（`src-tauri/src/navigation.rs`）对未知 scheme 一律取消。将来任何 `blob:` 的 iframe、预览、导出流程都会"什么都没发生"：没有 error 事件，不是 CSP 违规，控制台一行都不出，看起来像功能没写。

## 原因

`on_navigation` 挂的是 webview 的导航策略钩子，而各后端给的是**每一个 frame** 的导航，不只是主文档：

- macOS/iOS：`wry-0.55.1/src/wkwebview/navigation.rs` 的 `navigation_policy` 直接把 `action.request().URL()` 交给回调，从不看 `targetFrame`。
- Linux：`webkitgtk/mod.rs` 的 `connect_decide_policy` 对 `PolicyDecisionType::NavigationAction` 一概处理，子框架的导航也是 NavigationAction。
- Windows：wry 只注册 `NavigationStarting`（顶层文档），子框架的 `FrameNavigationStarting` 没接——同一份规则在这个平台上反而盖不到 iframe。

取消这个动作本身是静默的：`webkit_policy_decision_ignore` 和 `WKNavigationActionPolicy::Cancel` 都不产生任何可观测事件。

## 解法

`decide()` 放行 `blob:`：blob URL 只可能是自己的页面造出来的，带的也是自己的 origin，不是外部导航。`data:` 继续取消——任何能往屏幕上写字的东西都能造一个 `data:text/html`，载入等于让别人的 markup 顶掉整个 app（opaque origin，回不来）。

所有 Cancel 打一行 `navigation-guard: cancelled a navigation to …`，这是它留下的唯一痕迹。stderr 在跑 `tauri dev` 的终端和接着 Xcode 的设备上看得到，TestFlight 包里没地方落。

要真的用 `blob:` 的 iframe，还得把 `tauri.conf.json` 的 CSP `frame-src` 也加上 `blob:`，现在只有 `child-src` 有。
