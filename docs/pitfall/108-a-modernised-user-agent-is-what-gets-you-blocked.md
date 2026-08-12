# 把 WebKitGTK 的 User-Agent "改新"正是被 PerimeterX 拦下的原因

## 现象

隐藏 webview 取彭博正文（`src-tauri/src/webview_fetch`）。默认的 WebKitGTK UA 里 `Version/60.5` 看着像 2018 年的 Safari，顺手换成 `Version/18.5`——冷 profile 打首页立刻 403，标题 `Bloomberg - Are you a robot?`。不改回去，后面所有文章页全是验证码页。

## 原因

PerimeterX 不是只读 UA 字符串，是拿它和客户端其他所有可测特征对账。WebKitGTK 声称自己是 Safari 18.5，引擎行为对不上，直接判死。同一台机器、同一小时、每次冷 profile、只换 UA 一个变量，2026-08-11 实测：

| User-Agent | 结果 |
|---|---|
| 引擎默认值（不显式设置） | 200 |
| 同一字符串，显式 `set_user_agent` | 200 |
| 同上，`Version/18.5` 替掉 `Version/60.5` | 403 + 验证码 |
| 同上，`X11; Linux x86_64`（去掉 `Ubuntu;`） | 403 + 验证码 |
| Chrome 124 on Windows（info 引擎那条 UA） | 403 + 验证码 |

两次 200 夹在 403 中间，所以不是 IP 被升级封禁，就是 UA 这一个变量。注意去掉 `Ubuntu;` 也够触发——不是"版本号新旧"的问题，是任何偏离都不行。

`Version/60.5` 也不是 2018 年的遗留：AppleWebKit/605.1.15 这个 token WebKitGTK 一直沿用，`Version/` 后面那截是它自己的版本映射，2.52.3 就是这么报的。GNOME Web 用户发的就是这条。

## 解法

UA 显式 pin 成引擎默认值那一整条（`webview_fetch::policy::USER_AGENT`）：显式写是为了不随发行版升级 webkit2gtk 而漂移，取值必须是引擎真实的那条。

裸 HTTP 抓取用的是另一条 UA（`src/info/extract/user-agent.ts`，Chrome on Windows），那条给的是 feed 和 API，没有 JS 引擎可对账，不要合并。

改这条字符串等于改一次反爬对抗结果，必须重测，不能当成清理。
