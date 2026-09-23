# 域名解析不了时 WebKitGTK 不发 `load-failed`，页面就一直"加载中"

## 现象

隐藏 webview 取正文，喂一个不存在的域名（`this-host-does-not-exist.invalid`、`nonexistent-zz9zz-rp-test.com`），等到超时才返回，`network` 和 `timeout` 分不出来。

## 原因

WebKitGTK 2.52.3 实测：这两个域名只发一个 `load-changed started`，25 秒内不发 `load-failed`、不发 `finished`，provisional load 就挂在那里。TLS 失败不是这样——`self-signed.badssl.com` 1.3 秒发 `load-failed :: Unacceptable TLS certificate`，随后才是错误页的 `finished`。

也就是说 `load-failed` 能用，但只覆盖连上以后的失败；DNS 这一段没有事件可等。

## 解法

`network` 由 `load-failed` 判定（TLS、连接、被导航拦截取消都在这里），DNS 死掉的按 `timeout` 报——它确实是"到超时都没有任何动静"。调用方看到 `timeout` 不能假定"再试一次就好"，它也可能是域名根本不存在。

wry 自己不接 `load-failed`（`wry-0.55.1/src/webkitgtk/mod.rs` 只接 `load-changed`），所以 `with_webview` 里接这个信号不会被抢；但 `load-failed` 的累加器是 first-true-wins，将来谁再接一个返回 `true` 的处理器，后面的就收不到了。
