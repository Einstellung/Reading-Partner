# WebKitGTK 冷启动读 X 永久链接页，48 秒才报 load finished，推文 15 秒就在

## 现象

真 WebKitGTK（Python gi WebKit2 4.1，Xvfb，临时 profile，不登录，UA 同 `webview_fetch`），每个进程读的第一个 X 永久链接页，`load-changed` 的 FINISHED 在 48.2、48.4、49.3 秒才来；推文 15 秒左右已经渲染好（正文 1 110 字符，两个 `<article>`），之后 30 多秒正文不再变。同一进程接着读的页面 4.6 到 8.4 秒就 FINISHED。

`webview_fetch` 在 Linux 上只等这个事件（macOS 才有 `has_begun` 提前读），等待上限 `LOAD_TIMEOUT` 是 45 秒。所以应用启动后第一次读 X，会在 45 秒超时，`status` 是 `timeout`。

## 原因

页面在推文出来之后还在拉别的资源，WebKit 等它们全完才算加载完。第一次没有缓存，拖得最久。

## 解法

超时以后 `with_page` 照样调 `read_page`：读文档、跑调用方的脚本。所以内容拿得到，只是慢。读 X 时不看 `status`，只看脚本有没有读到推文（`info/x/read-post.ts` 读不到才再读一次）。`timeoutMs` 给 60 秒，让 45 秒的加载等待之后还有余量。别把 X 页面的 `timeout` 当成取不到。

*实测：2026-10-08*
