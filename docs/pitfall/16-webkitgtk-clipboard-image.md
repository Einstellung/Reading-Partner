# WebKitGTK 的 DOM paste 事件不带图片数据

现象：桌面端（Tauri，WebKitGTK webview）里复制一张图片再 Ctrl+V，DOM 的 `paste` 事件照常触发，但 `event.clipboardData.items` 里没有 image 项、`getData('text')` 也空——拿不到任何图片数据。Chrome/headless 下同样的代码能拿到 image blob，所以纯 DOM paste 的实现无头验证通过、真机却完全无反应（用户 M 阶段实测反馈：贴图无任何反应、无提示）。

原因：WebKitGTK 对 `paste` 事件里 image 类型 clipboardData 的支持和 Chromium 不一致，图片走系统剪贴板但不进 DOM 事件。

解法：双路。先试 `event.clipboardData` 的 image 项（Chrome / 将来 iPad 走这条）；事件里既没有图也没有文本，且在 Tauri 环境，就用 `@tauri-apps/plugin-clipboard-manager` 的 `readImage()` 从 Rust 侧直读系统剪贴板。`readImage()` 返回 `Image`，`await image.rgba()` 拿行主序 RGBA 字节、`await image.size()` 拿宽高；RGBA 经 `putImageData` 进 canvas 再压缩（`compressImageData`），不用 blob。

配套：Cargo 加 `tauri-plugin-clipboard-manager`，lib.rs `.plugin(tauri_plugin_clipboard_manager::init())`，capability 加 `clipboard-manager:allow-read-image`。

附带另一个兼容点：WebKitGTK 的 `createImageBitmap(blob)` 对贴进来的 blob 也偶发失败，`compressImage` 里加了 `<img>` + canvas 的回退解码路径。

判据：任一步失败都在 composer 里给可见提示（复用 hint），不再沉默——上一版就是沉默失败把用户坑了。代价：剪贴板确实空时按 Ctrl+V 会误报一条 "Couldn't read an image from the clipboard."，可接受。

状态：readImage 回退路径为对症实现，**待真机（WebKitGTK）确认**；Chrome 路径与占位状态机已单测覆盖。
