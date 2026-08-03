# 一个裸 `<a href>` 就能把整个 app 导航走

## 现象

AI 回答里的外链（`arXiv:1705.08439` 之类）点下去，WKWebView 把当前页面导航到外站。app 没了：没有返回手势，没有地址栏，正在读的书和正在进行的对话一起丢掉，只能杀掉重开。

速读文章正文里的外链是另一种表现：点下去什么都不发生，也不报错。

## 原因

Tauri 默认允许任何导航。不注册 `on_navigation`，webview 就是一个普通浏览器窗口，只是把浏览器该有的东西全拿掉了。

两条路的行为不同，是因为 `tauri-plugin-opener` 默认注入了一段点击脚本（`open_js_links_on_click`，默认开）：它在 window 上监听 click，只认 `target="_blank"` 的锚点和 ctrl/shift+click，命中就 `preventDefault` 并 invoke `plugin:opener|open_url`。

- markdown 渲染出来的裸 `<a href>` 没有 `target`，脚本直接放行，走原生导航——app 没了。
- sanitize 出来的文章正文带 `target="_blank"`，脚本接管了，但 `open_url` 这个 command 要过 `opener:allow-open-url` 的 scope，而 capabilities 里只放行了三个 OAuth 域名。scope 拒了，`preventDefault` 已经发生——点了等于没点。

## 解法

两层。

Rust 侧 `src-tauri/src/navigation.rs`：一个只为了 `on_navigation` 而存在的插件（这是唯一能盖住 `tauri.conf.json` 里声明的窗口的钩子），非本 app 页面的导航一律取消，是 http/https/mailto/tel 的交给系统浏览器。放行的是 `tauri:`（macOS/iOS/Linux 的生产 origin）、`img:`（图片代理）、`about:`，dev 构建再加 localhost 和私有 IPv4（`tauri ios dev` 从开发机 LAN 地址提供 vite）。`http(s)://tauri.localhost` 和 `http(s)://img.localhost` 是 wry 在 Windows/Android 上的等价形态，只在这两个平台的构建里放行，且必须没有显式端口；别的平台上没有任何东西在那儿应答，而文章正文能写出任意 http(s) 的 `<a href>`，无条件放行等于给第三方 markup 留了一个自己人的 host 名。OAuth 不受影响：桌面走 loopback socket，iOS 走 deep-link 插件，两条都不是 webview 导航。

前端 `src/platform/app/external-link.ts`：`MarkdownRenderer` 的 anchor 和两个文章正文（事件委托，不动 sanitize）显式调 `openUrl`。同源链接也要拦——相对路径同样会重载 SPA，状态一样丢。

capabilities 里 `opener:allow-open-url` 必须放开到 `http://*` / `https://*` / `mailto:*` / `tel:*`，否则前端和注入脚本的 invoke 都会被 scope 静默拒掉。Rust 侧的 `app.opener().open_url()` 不过 scope。

一个陷阱：Rust 里要用 `OpenerExt::opener()` 这个 handle API，不能用自由函数 `tauri_plugin_opener::open_url` —— 后者靠 `open` crate 起子进程，iOS 上等于什么都不做。

## 验的和没验的

浏览器里实测过 DOM 那半：外链被接管且不导航，相对链接被拦住，`#hash` 放行，无 href 的 `<a>` 不动。Rust 的判断规则有单测。

不会开两次的依据不在这一半——浏览器里根本没有那段注入脚本，实测碰不到它。真正的依据是 `tauri-plugin-opener` 2.5.4 的 `init-iife.js` 第一行：`if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey) return`（`~/.cargo/registry/src/*/tauri-plugin-opener-*/src/init-iife.js`）。我们的 handler 先 `preventDefault`，脚本就不再 invoke，和监听器谁先注册无关。插件改掉这一行就要重验。

没验的：真机上的完整链路（iPad 切 Safari 再切回来、桌面起默认浏览器），无头环境跑不了。
