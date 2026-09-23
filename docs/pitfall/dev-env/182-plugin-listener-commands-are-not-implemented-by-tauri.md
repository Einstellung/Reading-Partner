# `addPluginListener` 依赖两个 Tauri 核心没实现的命令

现象：移动端插件从 Swift 侧发事件，JS 侧 `addPluginListener` 一个监听都挂不上，插件发的事件永远没人收得到。

原因：`@tauri-apps/api` 2.9 的 `addPluginListener` 会 invoke `plugin:<name>|register_listener`（snake_case，回退到 `registerListener`），`PluginListener.unregister()` 对应 `remove_listener`。Tauri 核心这两个命令都没实现。

解法：插件自己在 Rust 侧实现 `register_listener` / `remove_listener`，转发给 Swift 基类。`plugins/voice/build.rs` 的 COMMANDS 列表里显式声明了这两条，旁边注释写明了为什么。

不是 iOS 专属：写 Android 的移动端插件、要往 JS 发事件，一样撞这一条。
