# macOS 上 data_directory 什么也不做，cookie 也不落在盘上

## 现象

抓取窗口在 macOS 上和 app 自己的 webview 共用一个 cookie 罐——`data_directory`
指向的 `webview-fetch-profile` 目录建出来了，里面永远是空的。
而 `jar.rs` 的暖机判据读的就是 `<profile>/cookies` 这个文件：读不到，
`Watch` 永远不变，彭博文章的暖机跑满 `WARMUP_LOAD_TIMEOUT` 之后报
`no load event and no cookies within 60s`。

## 原因

`data_directory` 是 WebKitGTK 和 WebView2 的概念。wry 0.55 的 macOS 后端不看它：
data store 只在 `incognito` → `nonPersistentDataStore`、
`data_store_identifier` → `dataStoreForIdentifier`、其余 → `defaultDataStore`
三者里选，默认落在 app 自己那个。

WKWebView 的 cookie 也不是一个能 tail 的文本文件，它在 store 目录里的
WebKit 私有格式中，只能通过 `WKHTTPCookieStore` 异步读。

## 解法

窗口加 `.data_store_identifier(PROFILE_DATA_STORE)`（固定 UUID，macOS 14+），
抓取的 store 就落在
`~/Library/WebKit/<app>/WebsiteDataStore/52656164-696e-6750-6172-746e65720001`，
和 app 自己的 `WebsiteData/` 分开，重启后还在。清空它就是清空抓取用的 profile，
测反爬时按这个路径 `rm -rf`。

暖机那半后来接上了：`wait_for_warm_jar` 改成收一个取样闭包，Linux 传读文件的，
macOS 传读 `WKHTTPCookieStore` 的，每条 cookie 拼成 `fingerprint` 本来就在解析的
那种行。彭博首页实测 0 → 44 行、22 次变化、19.5 秒安静。
那个 store 还有一条自己的坑，见 387。
