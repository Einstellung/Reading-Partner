# 没跑过网络的 data store 说自己一条 cookie 都没有

## 现象

macOS 上退出登录什么也没删：`clear_site_cookies` 返回空列表，盘上的
store 明明有 41 条 bloomberg.com 的 cookie，同一个进程里刚刚跑完一次首页加载。

给退出登录那个窗口加上采样，2026-09-22 实测：

| 时刻 | `getAllCookies:` 给回的条数 |
|---|---|
| 建窗后 49ms | 0 |
| 558ms | 0 |
| 1068ms / 1575ms / 2086ms / 2594ms | 0 |

不是时序问题，也不是拿错了 store：同一次打印里
`identifier` = `52656164-696E-6750-6172-746E65720001`（就是
`PROFILE_DATA_STORE`），`isPersistent` = true。而抓取窗口在同一个 store 上第一次
采样（255ms）就报 42 条。

## 原因

两个窗口的差别只有一个：抓取窗口 `navigate()` 去了真站点，退出登录的窗口只停在
`about:blank`——它存在的唯一理由就是够到 cookie store，本来就不该加载任何东西。

一个这个进程里还没人用过的 `WKWebsiteDataStore`，它的 `WKHTTPCookieStore`
是从一个还没建起来的会话上回答的，于是回答"空"。盘上的 cookie 要等有人让这个
store 干活才会读进来。一次真实加载会让它干活，所以抓取路径从来没撞上。

## 解法

`build_window` 建完窗口就发一次
`fetchDataRecordsOfTypes:[WKWebsiteDataTypeCookies]`（`jar::wake_store`）：
问 store 自己都存了什么，这一问就把它唤醒了。回调里的记录不要，也不等它——
排队就够了，这一发和后面每一次读都在主线程上按顺序排。

加上之后同一个退出登录窗口看到 41 条，删干净，返回
`["bloomberg.com", "www.bloomberg.com"]`，下一个进程的第一次采样是 0 条。

Linux 不受影响：WebKitGTK 的 cookie 在 `<profile>/cookies` 文本文件里，读文件不需要
任何人先干活。
