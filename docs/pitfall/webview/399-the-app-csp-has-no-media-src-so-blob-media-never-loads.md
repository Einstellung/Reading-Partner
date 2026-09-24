# app 的 CSP 没写 `media-src`，blob 源的 video/audio 一个字节都不加载

## 现象

EPUB 纸页里的 `<video>`/`<audio>` 按图片的办法用 blob URL 当 `src`（`createPageResources`），页面挂上 `tauri.conf.json` 里那条 CSP 之后：`readyState` 停在 0，`error.code` 4（`MEDIA_ERR_SRC_NOT_SUPPORTED`），`play()` 抛 `NotSupportedError`，看起来像编码不支持。`securitypolicyviolation` 报的是 `media-src blob`。同一页上 blob 源的 GIF/WebP/APNG 照常显示。

Linux WebKitGTK 2.52 和 iPhone 模拟器的 WKWebView 结果一样。去掉 CSP，或者加上 `media-src 'self' blob:`，同一个 blob 立刻能播（`currentTime` 1.5 s 走 0.37–1.44）。blob 的 MIME 是 `application/octet-stream`（`mimeOf` 不认 mp4/m4a）也不影响播放。

## 原因

CSP 里没写的取数指令回退到 `default-src 'self'`。`img-src` 写了 `blob:`，所以图一直没事；`media-src` 从没写过，媒体就只认 `'self'`，blob 被拦。拦下的媒体只报 `MEDIA_ERR_SRC_NOT_SUPPORTED`，错误本身不提 CSP。

## 解法

`tauri.conf.json` 的 CSP 加 `media-src 'self' blob:`。以后看到媒体报 code 4，先挂 `securitypolicyviolation` 监听看是不是被拦了，再怀疑编码。
