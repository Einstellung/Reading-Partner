# 按域名拼写猜 cookie，漏掉的正是会话那条

## 现象

退出登录（`src-tauri/src/webview_fetch/session.rs`）按站点主机名拼出要删的域名：`www.bloomberg.com`、`.www.bloomberg.com`、`bloomberg.com`、`.bloomberg.com`。删完 51 条 cookie 少了 50 条，剩下的那条在 `login.bloomberg.com` 上——恰恰是登录相关的那个子域。

## 原因

WebKit 的 `webkit_cookie_manager_delete_cookies_for_domain()` 只匹配传进去的那一个域名，不含子域。而站点把会话状态散在自己的子域上：登录走 `login.<站点>`，有的站还有 `auth.`、`account.`、`sso.`。从主机名出发能拼出的拼写永远只是实际存在的一个子集，猜多少个都不够。

## 解法

不猜，读 jar。wry 把 WebKit 的 cookie 持久化指到 `<profile>/cookies`，Netscape 文本格式，第一列就是域名（httpOnly 的行前缀 `#HttpOnly_`）。把这个文件里所有属于该站的域名捞出来——等于站点自己的域名，或者是它的子域——再逐个删。

方向只往下不往上：比给定主机更短的域名（`.com`）是别人的地盘，删了会连坐其他站点。`jar_domains()` 是纯函数，拿这条规则单测。

## 附带

同一份 jar 文本也用来重写文件（坑 111），所以读它这一步不是额外开销。
