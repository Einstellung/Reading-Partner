# 502 arXiv 的调用方各有各的钟，限流后也没人记得

## 现象

2026-10-17 主题搜索的重跑，5 条 arXiv 查询每条第一个请求就是 HTTP 429，梯子全部一步结束记 `rate_limited`。同一天早上 10:44 夜里采集的 arXiv 源（`arxiv-sys-hw`、`arxiv-cs-ro`）也失败。坑 497 修过之后，主题搜索自己的请求已经是 3 秒一个。

## 原因

arXiv 的规矩是每个 IP 每 3 秒最多一个请求、同时只开一个连接，按 IP 算，不管是哪个调用方发的。我们这边有三把各自独立的钟，加起来超了：

- 夜里采集（`collectAll`）把所有源 `Promise.all` 一起跑，arXiv 索引源经 `PluginDeps.fetchFn: infoFetch` → `interactiveRetry(infoFetch)`，`fetchWithRetry` 见到传了 `fetchFn` 就走 `noThrottle`（坑 497 那条规则），几条 arXiv 源同一瞬间发出，各自 1.5 秒后再重试一次。
- 主题搜索在 `build-live.ts` 自己建了一把 `createThrottle`，只管它自己的请求，和采集、阅读端互不知道。
- 阅读端不传 `fetchFn` 的走进程级 `hostThrottle`；传 `readingFetch` 的（桌面论文搜索 `research-worker`、`desk-tools`）照样 `noThrottle`。

另外两处让情况更糟：

- 被 429 之后什么都不记。`fetchWithRetry` 在 1.5 到 5 秒后重试，下一条查询、下一个调用方照发，每个被拒的请求都可能把 arXiv 那边的封禁往后推。重跑时 IP 还在封禁里，所以第一个请求就 429。
- 间隔按开始时间算，arXiv 的查询常要好几秒才回，上一个没回下一个就出去了，不是「一次一个连接」。
- 主题搜索和采集走 `infoFetch`，对 arXiv 也发的是冒充 Chrome 的浏览器 UA，arXiv 要的是能联系到人的描述性 UA。

## 解法

限速挪到传输层，全进程一把闸（`platform/http/host-gate.ts`）：`readingFetch` 和 `infoFetch` 都用 `gatedFetch` 包起来，每次请求（含重试）都过 `hostGate`，不管上面是谁、传没传 `fetchFn`。`fetchWithRetry` 不再自己限速，假 `fetchFn` 自然不等。

- arXiv 的 `arxiv.org`、`www.arxiv.org`、`export.arxiv.org` 算一组：一次只放一个请求，间隔从上一个请求回来时算 3 秒。S2、OpenAlex、NCBI 照旧按开始时间间隔；`readingFetch` 对表外主机默认 1 秒，`infoFetch` 不管表外主机。
- arXiv 回 429，或 403 且正文是「Rate exceeded」，回它的那个主机冷却（`www.arxiv.org` 算 `arxiv.org`）：10 分钟起，连着再被拒翻倍，封顶 4 小时；`Retry-After` 更长就按它（24 小时内）。冷却期间任何调用方都不往这个主机发请求，直接抛 `HostCoolingDownError`（是 `RateLimitError` 的子类，消息写「no request sent」和剩几分钟；被拒的那个请求本身由 `fetchWithRetry` 抛 `refused` 的同一个错误，消息写「refused the request with a rate limit」，因为它确实发出去了）；排在被拒那个请求后面的也不发。这个主机成功一次清零。冷却记在 localStorage，重启不会马上再撞。
- 冷却原来按整组记，2026-10-17/18 实测 export.arxiv.org 回 429 时 arxiv.org 的 abs、HTML、列表页和 rss.arxiv.org 都回 200，整组冷却让 export API 的一次限流把论文的 HTML 和 PDF 也停了 10 分钟到 4 小时。间隔仍按整组算，冷却改成按主机。
- `fetchWithRetry` 遇到冷却不重试、不等退避，直接抛。
- 主题搜索的梯子把冷却记成单独的结局 `cooling_down`（和真被 429 的 `rate_limited` 分开），源健康照样是 `failed`，「重跑第一次」会补；采集的源健康 `lastError` 写的就是那句「no request sent」。
- 两条传输对 arXiv、S2、OpenAlex、NCBI 都发 `POLITE_USER_AGENT`（项目名、仓库地址、联系邮箱），只在 Tauri 的 http 插件路径上能设；浏览器里的 fetch 不能改 UA。
- 主题搜索一次 run 里读论文开头和读全文都取同一页 arXiv HTML，`fetch-memo.ts` 把 arXiv 的 200 回答记 30 分钟、最多 24 页，第二次不再发请求。

以后加任何走 HTTP 的路径，用 `readingFetch` 或 `infoFetch`，不要自己 `cleanTauriFetch` 或建一把私有的钟。
