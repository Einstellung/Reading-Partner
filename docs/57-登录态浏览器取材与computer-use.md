# 登录态浏览器取材与 computer-use

> 本文是 [17](./17-信息源系统.md)、[35](./35-简报漏斗.md)、[36](./36-采集端与阅读端.md) 的下游，[56](./56-YouTube访谈接入.md) 的姊妹篇。定两件事：读 X 走带登录态的真浏览器加 DOM 抽取，正常路径不过模型；GUI 专用模型（computer-use）是后一阶段的能力，留给拿不到 DOM 的场景。

现在不实现。info 侧的能力将来分阶段逐步放大，本文的价值是把能做什么、怎么做、代价多少记下来。docs/17 那套信息源系统将来要整体推翻重做，本文写在今天的 descriptor / engine 结构上，重做时按这里的事实和决定重新落。

## 实测事实（2026-09-07）

全部在 Xvfb 里跑，没开过可见窗口，没登录任何账号，没碰用户的浏览器 profile。

- 机器：RTX 3060 12 GB、16 核 31 GB、X11 会话、Chrome 144、Xvfb 和 xvfb-run 都在、Playwright 的 chromium/firefox/webkit 已缓存、node/bun/uv 都在。没有 ollama，没有 xdotool。
- headless 被 X 拦，headful 不拦。同一份脚本、同一个 profile、同一分钟内交替三轮，headless 每次 `net::ERR_HTTP_RESPONSE_CODE_FAILURE`，headful 每次正常返回 7 条帖子。Xvfb 不是可选项。
- `navigator.webdriver` 默认 true，加 `--disable-blink-features=AutomationControlled` 后变 false。
- 不需要真鼠标键盘事件。整个读取只有 `page.goto` 和 `page.mouse.wheel`，没有一次点击，xdotool 不用装。
- 每个主页 6.5 秒拿 7-9 条，约 2300 字符 660 token，正文、作者、日期、永久链接、图片数一次 `page.evaluate` 全拿到。同一屏截图 1280×1600 是 2668 视觉 token，信息还更少。
- 未登录时间线滚 4 次也只有 7-9 条，然后是登录墙翻不过去；顺序不严格倒序，有陈旧嫌疑（karpathy 最新一条停在 8 月 2 日，sama 有 7 小时前的）。"每人最近 10 条"未登录满足不了。
- 时间线上点 "Show more" 点不动（0 次成功），永久链接页给全文（343 字符 → 1689 字符）。
- 未登录的 DOM 里一个 `data-testid` 都没有，也没有 `<time>`，只有裸 `<article>`。流传的 `article[data-testid="tweet"]` 是登录态的选择器，抓未登录页返回 0 条。
- 现有 `src-tauri/src/webview_fetch/` 那条 WebKit 也能读 x.com：7 个 article、2632 字符、12.4 秒，比 Chrome 慢一倍。但 Playwright 的 WebKit 不是 Tauri 用的 WebKitGTK，这是提示不是证明。
- 这台机器上跑着 clash-party，出口 IP 是不是代理直接影响 X 看到的画像。下面的风险判断按家用宽带 IP 写。

## 架构

```
Xvfb :99 (1280x1600x24)          常驻，71 MB
  └─ Chrome 144 headful          一个长命进程
       --user-data-dir=<AppData>/x-profile   用户登录一次，cookie 留这里
       --disable-blink-features=AutomationControlled
       --remote-debugging-port=<随机>，只绑 127.0.0.1
  └─ 驱动：TypeScript + playwright-core 走 CDP
  └─ 输出：现有 item 形状进条目池，itemId 用 status id，去重走现有 pool marks
```

正常路径不过任何模型，结果交给现有粗筛（docs/35）。不需要 Python 运行时，playwright-core 是纯 JS，驱动逻辑不到 200 行，留在现有 TS 代码库里。

Tauri 拉起要处理三件事：进程组能整组杀掉（Chrome 会 fork 一堆子进程）、app 退出时收尸、Chrome 崩了能重起且不丢 profile。恢复策略：Xvfb 挂了重起 Xvfb 再重起 Chrome；Chrome 挂了只重起 Chrome，profile 在磁盘上（实测 146 MB，Cookies 和 Local Storage 都在）；CDP 断了重连；整轮失败写进采集端状态文件的 `halt`，按 docs/36 的机制走到手机上。

登录是全程唯一开窗口的地方。Xvfb 里的窗口用户看不见，所以要在真实显示器上开一个可见 Chrome 让用户登完关掉，之后 profile 交给 Xvfb 里的实例。形态和 `openSiteSignIn` 一致：用户自己点触发，关窗口就是完成信号，不猜 DOM。会话失效不自动重登，按 docs/36 写进状态文件的 `sites`，简报卡上说一句，等用户到 PC 前面处理。

和 `webview_fetch` 并列不替代：它管"给一个 URL 取一篇正文"，新通道管"驱动一个会话连续读列表"。两者共享 docs/17 第二条红线——登录由用户自己完成，cookie 不出本机，只为自己读。

## 风险与规矩

这条路违反 X 的服务条款，代价是账号不是罚款。规矩：用一个真实有历史的账号（专门注册的新号才是被封的那个画像），只读不发不关注不点赞，节奏加抖动，一个 IP 一个 profile 一个浏览器长期不变，遇到 429、挑战页或被登出就整轮停下来问用户，绝不自动重登。上线从 5 个账号起步，观察一周再加到 30。

## 成本

口径：30 个账号，每 2 小时一轮，每人最近 10 条。时间上一轮 3.3 分钟、一天 12 轮 40 分钟；加上展开截断正文，一轮最多 13 分钟、一天 2.6 小时。对常驻的机器不构成压力。

| 路线 | 月成本 |
| --- | --- |
| 纯 DOM，不过模型 | 0 |
| DOM 文本过一次便宜模型（按 status id 去重后稳态每轮 15% 是新帖） | $1-3 |
| 视觉驱动（Gemini CU $1.25/M 到 Opus 5 $5/M） | $337-1350 |

视觉驱动比 DOM 贵 30 到 100 倍，慢四倍，多一整类失败模式（点错位置、滚过头、幻觉出不存在的帖子），换来的信息是零——`document.querySelectorAll('article')` 一行就给了同样的文字。

## 开源栈

只引 playwright-core（Apache 2.0，`bun add` 1.3 秒装完直接 import）。browser-use、Stagehand、UI-TARS-desktop 只借思路，为一个不需要 LLM 的读取循环引整个 agent 框架不划算。Skyvern 是 AGPL，不用。Playwright MCP 默认有头，不用于生产。

## computer-use 专用模型（后一阶段）

GUI 专用模型不是失败的路线，是另一个阶段的能力。适用边界是拿不到 DOM 的场景：原生桌面应用（微信 PC 客户端里的公众号和群）、手机 app、canvas 渲染或故意混淆 DOM 的站、导航本身需要判断的挑战页和弹窗。

读 X 这个任务里它没活干。ScreenSpot-Pro 衡量的是在高分辨率界面里点中小图标、输出坐标，而这里一次点击都没有。它在 X 上只留两个口子：帖子内容在图里时截那一张图问模型图上写了什么；DOM 抽取返回 0 条时截一张整页图问是登录墙、挑战页、限流还是 X 改了结构，把"静默抓不到东西"变成一句能写进状态文件的话。

| 模型 | 参数 | 许可 | 判定 |
| --- | --- | --- | --- |
| Holo2-4B | 4B（Qwen3-VL-4B-Thinking 底） | Apache 2.0 | 推荐，Q8。它是通用 VLM 的微调，看图说话的能力还在，这里要的正是那个 |
| OpenCUA-7B | 7B | MIT | 备选，许可最干净 |
| MAI-UI-2B | 2B | Apache 2.0 | 只要更小选它 |
| UI-Venus-2-9B | 9B | 未定 | 不选。ScreenSpot-Pro 73.0 是开源里最高，但权重许可官方写着待最终确认，此前的 Apache 声明还被主动撤掉过 |
| UI-TARS-2 | — | — | 权重没放，论文可读 |

显存账：这张卡上 2-4B 舒服，8-9B 要 Q4 且大图要小心，27B 以上一律装不下。llama.cpp 和 ollama 已正式支持 Qwen3-VL 系 GGUF，语言部分和视觉编码器可分别选精度。托管的只做价格对照：Claude computer toolset 随模型计价，Gemini computer use $0.75/$3.75，OpenAI computer-use-preview $3/$12。

基础设施和 DOM 路线一模一样，只差把模型接上。

## 主题积累型信息

第一个真实用例不是 X，是医美、育儿、装修、留学这类：用户长期在意一件事，信息散在小红书、抖音、知乎、大众点评、微信群里，没有一条是新闻，单条价值低，攒起来才有用。

它和简报不是同一形状。简报是时间流，问"今天什么重要"；这类是主题积累，问"关于这件事我现在知道什么、和上周比变了什么"，接近 docs/48 的 concern。噪声性质也不同：新闻的噪声是不相关，这类的噪声是软广和水军，分拣要从"重不重要"变成"可不可信"。来源正是拿不到 DOM 或 DOM 很脏的那类，所以它是 GUI 模型路线的第一个用例。形态留给 docs/17 重做时一起定，本文只记需求和判断。这类平台的账号风险比 X 重，规矩同上。医疗内容的边界：AI 归纳的是用户们怎么说，不给医疗建议。

## 分步（都不做，记着）

1. 打通读取通道，半天。新增一个 discovery kind（`browser-dom` 之类），采集端拉起 Xvfb + Chrome，一个长命 page 顺序导航，DOM 抽成 item。先跑未登录，今天就能证明全部管道。
2. 登录一次，半天。可见 Chrome 登完交给 Xvfb 实例，会话状态写进 `sites`。登录后必须重做一遍选择器。
3. 展开截断正文，半天。带 "Show more" 的帖子开永久链接页，每轮限量带抖动。
4. 接进漏斗，一天。到这里功能完整。
5. 视觉兜底，以后按需，只用于描述图和诊断失败。

三个没验的，按风险排序：登录后的 DOM 结构；未登录时间线那个上限在有登录态后是不是消失；一轮 30 个主页连续访问会不会被限流（本次总共只打了约 10 次 x.com）。

*2026-09-07*
