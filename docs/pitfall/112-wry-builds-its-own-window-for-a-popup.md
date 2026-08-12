# 允许 `window.open` 之后，wry 自己造一个 GTK 窗口，那个窗口没人管

## 现象

登录窗口（`src-tauri/src/webview_fetch/session.rs`）要支持「用 Google 继续」这类 SSO，所以只有它把 `on_new_window` 设成 `Allow`。实测（Xvfb 里 eval 一句 `window.open()`）：屏幕上多出一个标题是那个 URL 的窗口，`IsViewable`。

它不是 Tauri 窗口：`app.webview_windows()` 里没有，导航拦截（`navigation.rs` 的插件钩子）根本看不到它，代码里也拿不到任何句柄。

## 原因

`wry-0.55.1/src/webkitgtk/mod.rs` 的 `connect_create`：`NewWindowResponse::Allow` 那一支自己 `gtk::ApplicationWindow::builder()` 建窗、`show_all()`、塞一个新 webview 进去。Tauri 不知道这个窗口存在。

**未验证的那半**：同文件里每个 webview 都接了 `connect_close(|webview| webview.destroy())`——销毁的是 webview 不是窗口。照这个读法，弹窗自己调 `window.close()` 之后会剩一个空窗口留在屏幕上。没有真 SSO 账号，这半只是读源码得出的，没跑过。

## 解法

登录窗口起来之后记一份 GTK toplevel 快照（`gtk::Window::list_toplevels()`，只能在主线程），登录结束时再列一次：不在快照里、又不属于任何 Tauri 窗口的，`gtk_widget_destroy` 掉。地址（`usize`）而不是 widget 本身跨线程传，因为 `gtk::Widget` 不是 `Send`；地址被复用最多让清扫漏掉一个窗口，不会误杀。

实测：t=10s 弹窗和登录窗口都在，登录窗口关掉之后只剩主窗口，弹窗没了，主窗口没被碰。

隐藏的取正文窗口一律 `Deny`，不走这条路。
