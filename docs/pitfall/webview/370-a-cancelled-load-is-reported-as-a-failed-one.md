# WebKit 把「被取代的导航」也报成 load-failed，取页面直接判 network 失败

现象：用隐藏 webview 取 `https://www.bing.com/images/search?q=mapo+tofu&form=HDRSC2`，2.9 秒就返回 `status: network`、`detail: "…: Load request cancelled"`。可此时页面是好的：标题 `mapo tofu - Search Images`，`documentElement.outerHTML` 已经 673798 个字符，`a.iusc` 的结果也在里面。同一条路径取普通文章页从不这样。

原因：Bing 的图片搜索页加载完第一版之后，自己把地址换成带布局参数的那条（最终 URL 是 `…&first=1&cw=1177&ch=0`）。旧的那次导航被新的取代，WebKitGTK 对被取消的导航照样发 `load-failed`（`WebKitNetworkError::Cancelled`），`webview_fetch` 的信号回调把它当成 DNS/TLS 那类失败发进了通道，`wait_for_load` 收到 `Failed` 立刻结束，settle 一轮都没跑。

解法：`connect_load_failed` 里先看错误域，`error.matches(webkit2gtk::NetworkError::Cancelled)` 就直接返回，不往通道里发。取消不是失败——要么马上有新的导航接上（此例 5 秒后 `finished`，HTML 131 万字符），要么这个页本来就没了，而真正卡住的加载由 `LOAD_TIMEOUT` 管。改完同一条 URL 回 `status: ok`。
