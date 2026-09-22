# 钉死的 UA 是钉给某一个引擎的

## 现象

隐藏 webview 的 UA 常量（坑 108 一条一条测出来的那串）搬到 macOS 上，
彭博首页 1.3 秒回 "Bloomberg - Are you a robot?"。
一行不改、只是不设 UA，同一台机器同一个 IP、抓取用的 store 清空重来，
同一个首页给回 8.1 MB 的 "Bloomberg Asia"。

2026-09-22 实测，每次跑前删掉 `~/Library/WebKit/reading-partner/WebsiteDataStore/<uuid>`：

| macOS 上的 User-Agent | 结果 |
|---|---|
| `policy::USER_AGENT`（WebKitGTK 的默认串） | 1.3s 验证码 |
| 不设 | 8.1 MB 首页 |
| 手写一条当前的 Safari on macOS 串 | 1.6s 验证码 |

## 原因

坑 108 的结论不是「用这串」，是「用引擎自己会发的那串」。那串是 WebKitGTK 的默认值，
在 WKWebView 上它描述的是一个不存在的客户端。

第三行才是关键：手写一条字字正确的 Safari 串照样被拦。PerimeterX 拿 UA 和客户端
其他特征对账，而设了 `customUserAgent` 的 WKWebView 和没设的不是同一个客户端——
写对字符串不等于让引擎自己去发。

## 解法

`policy::user_agent()` 按平台回答：Linux 给那串常量，macOS 给 `None`，
`build_window` 只在 `Some` 时调 `.user_agent()`。macOS 这边因此没有需要跟着
Safari 版本更新的常量。

`RP_WEBVIEW_FETCH_UA=<串|default>` 是这张表的量具，不用重编就能换一个身份再测。
