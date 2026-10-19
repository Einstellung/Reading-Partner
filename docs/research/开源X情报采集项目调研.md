# 开源 X 情报采集项目调研

2026-10-19。起因：主题搜索（[88](../info/88-主题搜索.md)）第一次真跑的结果不好，自己试错不如看别人怎么做。这份看了四十来个公开项目，按「取数、浏览器内读、AI 筛选层、研究 agent 和论文侧」分类，只读公开页面和仓库，没有登录 X，没有碰 X 的任何接口，也没有运行别人的代码。星数、许可证、最近提交来自 GitHub 公开接口，2026-10-19 取；README 里的说法只读了没验证的，标了「自述」。

已有调研不重复：[AI信息筛选调研](./AI信息筛选调研.md)（arxiv-sanity、Scholar Inbox、auto-news、NewsBlur、x-algorithm、Kagi）、[舆情监测agent调研](./舆情监测agent调研.md)、[last30days拆解](./last30days拆解.md)、[ai-research-arm拆解](./ai-research-arm拆解.md)。这里只在它们没覆盖的地方补。

## 结论

1. 没有一个开源项目做的是我们这件事（人速读 X 搜索页、再顺链接读原文）。大多数项目走的是用 cookie 或账号池直接调 X 的 GraphQL，这条路要么已死、要么在边缘，我们不走。可借的是它们的查询写法、过滤规则、链接处理和「先看元数据再决定开不开」的次序。
2. 最值得做的一件事：不再靠 DOM 解析，改成在页面里旁听 X 自己的 GraphQL 响应（twitter-web-exporter 的做法，MIT）。响应里直接有全文（`note_tweet`）、展开后的外链（`expanded_url`）、引用帖、卡片、完整计数。这一条同时消掉观察到的第 2、6 点里的「截断」「开永久链接页」「t.co 展开」三个麻烦。
3. 查询要把信号写进查询本身：`min_faves`、`filter:links`、`lang`、`url:`、`-filter:replies`，按语言给不同阈值。有项目这样用并跑在生产里（ai-news-brief：英文 `min_faves:1000`，中文 `min_faves:200`）。我们现在是读完 305 条再筛，次序反了。
4. 第 1 点（门拿中文问句比英文帖）是我们自己的 bug，别人的做法是搜索词和排序问句分开、各用各的语言。门应该对着英文锚词和英文搜索词算，并加一个「全零就报警并回退」的保险。
5. 「推广 / 刷互动 / 职业焦虑」类噪音，别人靠三样：账号白名单（最强）、明写的负例和跳过规则、一个「离原始出处多远」的枚举。没有项目公开过准确率，我们得自己从这次的 305 条里标一个小金标。

## 项目表

许可证栏：AGPL、GPL、NC、无许可证、闭源，一律只借思路，不抄代码。MIT、Apache、Unlicense 可以参考实现，抄代码前仍要保留版权声明。

### A. 取数工具

| 项目 | 许可 | 星 / 最近提交 | 做法 | 可借的想法 |
|---|---|---|---|---|
| [vladkens/twscrape](https://github.com/vladkens/twscrape) | MIT | 2.9k / 2026-10-05 | 账号池（cookie 或密码）调 X GraphQL，SQLite 存会话，按账号按接口记限额，被限就换号；默认 Latest，`product` 可选 Top / Media | `TextLink{url, text, tcourl}` 同时留展开链接、显示文字、t.co；README 自述 X 条款不鼓励多账号 |
| [d60/twikit](https://github.com/d60/twikit) | MIT | 4.7k / 2026-03-10 | 单账号密码登录、cookie 文件复用，调 GraphQL，含发帖点赞 | 自带「保护账号」文档：登录越少越好、cookie 复用、请求间隔 5 到 10 秒、搜索间隔约 10 秒、批间 60 秒、被限后等 15 分钟；第三方统计 135 到 160 个未关 issue，登录挑战和 429 常见，属间歇可用 |
| [Altimis/Scweet](https://github.com/Altimis/Scweet) | MIT | 1.7k / 2026-09-29 | 只认 `auth_token` cookie，调 GraphQL；从 X 的 JS 包里读 query id；`resume`；读响应头限额，离上限还差 2 个请求就停 | 查询构造器把 `min_likes` 映射成 `min_faves:`、`has_links` 映射成 `filter:links`、`lang:`、`-filter:replies`；错误分类（query id 过期、会话死、限流）各有处置；自述单号每天几百到几千条；「不要用个人账号」 |
| [Rishikant181/Rettiwt-API](https://github.com/Rishikant181/Rettiwt-API) | MIT | 0.9k / 2026-10-19 | Node 库，访客模式只读单帖和时间线，搜索要 cookie 编成的 API key；暴露 `x-rate-limit-*` 响应头 | 把限额响应头当一等信号读；自述 key 就是 cookie，等同口令 |
| [mahrtayyab/tweety](https://github.com/mahrtayyab/tweety) | 无许可证 | 0.7k / 2026-09-13 | 逆向前端 API | 只借思路；README 警告滥用会让账号变 `read_only` |
| [jackwener/twitter-cli](https://github.com/jackwener/twitter-cli) | Apache-2.0 | 3.0k / 2026-05-07 | 浏览器 cookie，调 GraphQL，TLS 指纹伪装，生成 `x-client-transaction-id`；`search --has links --lang --since --exclude retweets`；`article` 把 X Article 导出成 Markdown | 过滤打分：`赞×1 + 转×3 + 回复×2 + 书签×5 + log10(浏览)×0.5`，三种模式 topN（默认 20）、score（默认 ≥50）、all；请求间隔 2.5 秒乘 0.7 到 1.5 的抖动，单次最多取 200 条，429 退避 3 次；自述建议用住宅 IP |
| [the-convocation/twitter-scraper](https://github.com/the-convocation/twitter-scraper) | MIT | 0.6k / 2026-04-01 | TypeScript，逆向前端 API，访客可读、登录后可搜 | scrapfly 评测写它的修复「往往要几天才发出」，动态限流可暂停 13 分钟 |
| [helmisatria/tweet-harvest](https://github.com/helmisatria/tweet-harvest) | 未声明（NOASSERTION） | 0.2k / 2025-12-16 | Playwright 开搜索页，`auth_token` cookie，导出 CSV；自述「仅供教学」 | 和我们最像的一种（真浏览器读搜索页），但没有限速、没有读链接的设计 |
| [steipete/bird](https://github.com/steipete/bird)（原仓库已删） | MIT | 已下架；npm 0.8.0 已标弃用 | cookie 调 GraphQL 的命令行：`read`、`thread`、`search --all`，Notes 和 Articles 返回全文，运行时从 X 的 JS 包里刷新 query id | 作者 2026-02 自己下架，自述原因是它用 Twitter Web API 而 X 转向按量付费（来自搜索结果摘要，没打开 X 页面核对）；分叉 geekavan/bird、Gitnapp/x-cli 仍在 |
| [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub) | AGPL-3.0 | 46.6k / 2026-10-19 | X 路由要 cookie | 只借思路，已在 [AI信息筛选调研](./AI信息筛选调研.md) 评过；本次没重新核对 X 路由现状 |
| [RSS-Bridge](https://github.com/RSS-Bridge/rss-bridge) | Unlicense | 9.3k / 2026-10-19 | 通用桥 | 没读 X 桥的现状，不下结论 |
| [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach) | MIT | 99.3k / 2026-10-15 | 给 agent 配多渠道取数；X 默认走 twitter-cli，后备 OpenCLI，再后备 bird；只接受用户用 Cookie-Editor 手工导出的 cookie | 自述「存在被平台检测并封号的风险，建议小号」 |
| [jackwener/opencli](https://github.com/jackwener/opencli) | Apache-2.0 | 30.4k / 2026-10-17 | 用浏览器扩展驱动用户已登录的 Chrome | 路线和我们的「登录态浏览器」同族；没确认它的 X 适配器怎么读 |

### B. 死了或在边缘的

| 项目 | 现状 | 为什么 |
|---|---|---|
| snscrape（GPL-3.0，5.5k） | 最后提交 2023-11-15，X 部分不可用 | X 2023-06-30 起搜索和时间线要登录，匿名访客接口关闭；issue #996 是维护者自己开的，标 upstream；来源是第三方汇总，没读到维护者的说明 |
| Twint（MIT，16.4k） | 2023 年存档 | 同上，靠匿名接口 |
| n0madic/twitter-scraper（MIT） | 2023-11 存档 | 同上 |
| trevorhobenshield/twitter-api-client（MIT，1.9k） | 最后提交 2024-05 | 没读到原因，推测随 API 变动无人跟 |
| Nitter（AGPL-3.0，14.5k） | 仓库显示 2026-10-09 存档；2026-08-24 X Corp 发律师函，要求永久下架实例和仓库；维护者 10-10 说在找资金和法律帮助 | 报道口径不一：另一篇写 09-11 存档，09-07 的 Privacy Guides 报道说会继续；状态不稳，别依赖。AINews 的仓库说本地抓取器里有「Reddit 和 Twitter/Nitter 采集」，这条是否受影响没核实 |
| bird | 作者下架 | 见上 |
| agent-twitter-client（elizaOS 用） | 找不到现仓库，elizaOS/tcm390 两个路径都 404 | 第三方排障文档说密码登录被 X 挡（`ArkoseLogin`、`LoginUserPasskeyIdentifier`），会话被作废后账号被锁；没读到仓库本身 |
| Liberate Science 的预印本机器人 | 2023-02 关停 | 搜索摘要说原因包含 X API 不再免费 |

规律：死的都是靠匿名接口、或靠单一第三方前端、或靠一个人维护的 cookie 客户端。X 的两次收紧（2023 登录墙、2026 对 Nitter 的律师函）都先砍「没有账号的读法」。登录态的真浏览器读法没有出现过被点名下架的案例，但也没有人公开过它的封号率。

### C. 在浏览器里读、不调接口

| 项目 | 许可 | 星 / 最近提交 | 做法 | 可借的想法 |
|---|---|---|---|---|
| [prinsss/twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter) | MIT | 2.8k / 2026-08-31 | 油猴脚本，钩住页面自己的 `XMLHttpRequest`，匹配 `/graphql/<id>/SearchTimeline` 一类请求，解析返回的 JSON，用户滚到哪导出到哪；不自己发请求，不自动滚动 | 读过源码：全文取 `note_tweet.note_tweet_results.result.text`，外链取 `legacy.entities.urls[].expanded_url`，引用帖取 `quoted_status_result`；Top、Latest、Media 三种搜索结果都解析；自述「像人手工复制，封号不太可能」（维护者判断，不是保证） |
| [imbue-ai/bouncer](https://github.com/imbue-ai/bouncer) | AGPL-3.0 | 0.4k / 2026-10-19 | 扩展里用 MutationObserver 看信息流，帖子排队交给模型按「用自然语言写的过滤主题」分类，隐藏并给理由，按帖缓存结果；本地 WebGPU 模型或云端 | 只借思路：分类结果缓存、让用户看到被过滤的帖和理由；Imbue 自述小模型「遇到比喻就出错」，没给准确率 |
| X-Timeline-Curator（Shantykins） | MIT | 1 星 / 2025-08 | 浏览器里用 `all-MiniLM-L6-v2` 把兴趣词和帖子嵌入，最大余弦相似度低于 0.35 就隐藏 | 这是英文单语模型，对中英混合没用；说明「本地嵌入门」要用多语言模型 |
| altryne/twitter-timeline-analyzer | 页面写 MIT，接口报无许可证 | 2 星 / 2026-09 | 按用户反馈让模型重写「话题判定规则」和正则 | 反馈改规则，不改模型 |
| Cocoon（HN Show 帖） | 没核实仓库 | — | Grok 经 OpenRouter 判每条帖是否合兴趣 | 没有更多公开细节 |

### D. AI 筛选和摘要层

| 项目 | 许可 | 星 / 最近提交 | 做法 | 可借的想法 |
|---|---|---|---|---|
| [frankzch/ai-news-brief](https://github.com/frankzch/ai-news-brief) | MIT | 17 / 2026-10-12 | 94 个源；X 部分用 Playwright 持久登录读：12 条关键词搜索、约 310 个账号的 List、两条全站高赞搜索（英文 `min_faves:1000`，中文 `min_faves:200`）；LLM 做相关性过滤和重要度；去重用 SimHash 加 pgvector | 读过源码：搜索词写成 `{词} (lang:zh OR lang:en) since:{日期}`，开 `f=top`，先在搜索页只收「链接、赞、回复、时间、正文」，达到有效条数或「新出现的帖全部低于阈值」就停，只对合格的才开详情页；`scrollTo` 到底加 2 秒，每词最多 20 次滚动，被限就整条放弃 |
| [ebelo/x-daily-summary](https://github.com/ebelo/x-daily-summary) | MIT | 3 / 2026-06-13 | 用 X 官方 API（自述 800 条约 4 美元）；本地模式先用 `nomic-embed-text` 把每条帖归进六个类别，每类取互动最高的 10 条，再每类一次生成 | 按类别分桶取前 N，再每桶一次生成；自述本地 800 条分类约 10 秒 |
| [zarazhangrui/follow-builders](https://github.com/zarazhangrui/follow-builders) | 无许可证 | 6.9k / 2026-10-19 | 26 个 X 账号加 6 个播客的中心名单，中心服务器用官方 API 取，用户的 agent 只拉一份每日 JSON | 账号白名单是最强的一层过滤；摘要提示词文件拆开（推文、播客、博客、开场、翻译）；只借思路 |
| [ginobefun/BestBlogs](https://github.com/ginobefun/BestBlogs) | 无许可证 | 4.1k / 2026-07-08 | 两段式：便宜模型只看元数据给 0 到 100，`value ≥ 30` 才进全文；提示词里有 8 个示例含负例（过度营销、只有时间地点的通知、促销、非目标语言）；X 内容走第三方 RSS | 只借思路：负例要写进提示词 |
| [YanCheng-go/my-focal-ai](https://github.com/YanCheng-go/my-focal-ai) | CC BY-NC 4.0 | 13 / 2026-10-19 | 「信号重于噪音、机制重于观点、做事的人重于评论者」；输出 `source_proximity`：origin / implementation / derivative / noise | 只借思路。README 没讲它怎么取 X，本次只确认了许可证 |
| [alexknowshtml/smaug](https://github.com/alexknowshtml/smaug) | MIT | 1.0k / 2026-02-03 | 经 bird 取书签和点赞；展开 t.co；GitHub 链接取 star、简介、README；文章链接取标题作者正文；X Article 取全文，书签不是原作者所发时再去搜原作者那条，搜不到退回标题和描述；引用和回复线程带上下文；按域名分类，满 8 条并行处理 | 链接的下一步是按域名分类各有读法；没有相关性过滤，靠分类规则路由 |
| [finaldie/auto-news](https://github.com/finaldie/auto-news) | MIT | 0.9k / 2025-07-19 | 见[AI信息筛选调研](./AI信息筛选调研.md) | — |
| AINews（smol-ai/ainews-web-2025） | 无许可证 | 45 / 2026-10-17 | 综述 Discord、Reddit、X；仓库里有 `tools/scrapers`，支持断点续跑 | 没读到 X 的选源细节，不下结论 |
| [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) | Apache-2.0 | 见旧调研 | 见[AI信息筛选调研](./AI信息筛选调研.md) | 同作者衰减、同会话折叠 |
| xAI Grok `x_search` | 商业 API | — | 服务端搜 X 帖、用户、线程；last30days 把它当一路后端 | 第三方页面写 5 美元每千次调用、单次约 45 秒；没读到 xAI 自己的参数页（我们取到的两页都 404 或不含），未核实 |

### E. 研究 agent 与论文侧

| 项目 | 许可 | 星 / 最近提交 | 说明 |
|---|---|---|---|
| [mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill) | MIT | 64.7k / 2026-10-18 | 已移植打分。它在打分之外还做：X 单源多后端自动切换（官方 API、浏览器 cookie、付费服务、vendored 的 bird、Grok）；先解析句柄（含创始人）再取数；FROM 和 ABOUT 两条路分开排（某人自己说的和别人谈他的）；`--diagnose` 主动探测登录并给出修复建议；`--store` 存 SQLite，监视列表只报增量 |
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | 30.2k / 2026-10-10 | 没有任何社交媒体检索器；规划器先拆研究问题，各自抓取，摘要带来源，再汇总。深度模式按深度和广度递归 |
| [stanford-oval/storm](https://github.com/stanford-oval/storm) | MIT | 31.7k / 2025-09-30 | 没有 X；写作前先读同类主题的已有文章，发现不同视角，再模拟提问。对第 5 点有参考：先学领域的词汇和分支，再定查询 |
| langchain-ai/open_deep_research | MIT | 12.7k / 2026-08-10，已存档 | 没有 X，不用看 |
| Hugging Face Daily Papers | 站点 | — | 社区投票的每日论文榜，已在 [HF 调研](./Hugging%20Face%20作为检索与发现源调研.md)；我们已接论文搜索 |
| Emergent Mind | 站点 | — | 自述追踪 arXiv 并按社交热度排；关于页没写怎么排、怎么找推文，不可复制 |
| dair-ai/ML-Papers-of-the-Week | 无许可证 | 13.3k / 2026-10-12 | 人工周榜，附推文和代码链接；选法没写 |
| arXiv 上的两篇研究 | — | — | 2112.08073：传播 arXiv 论文的人按研究领域成群，有些关键人用英文加母语做桥；2106.07213（TweetPap）：论文和推文配对的数据集。两篇的摘要都没讲噪音 |

## 逐点对照：我们观察到的问题

### 1. 门拿中文问句比英文帖，一个都过不了

别人把「搜索词」和「排序问句」分成两个字段（last30days：`search_query` 简短、按平台标题写法；`ranking_query` 是自然语言问句，给重排用），本地过滤用的是前者。我们的配置里 `queries[].x` 和 `ranking` 同样分开；这次 bug 是 X 读取器的门（`x-reader.ts` 的 `relevance` 字段）拿到的是中文问句，build 用的是英文查询。

- 门对着英文锚词和英文搜索词算，`ranking` 只给模型重排用，且在起草时同时写英文版。
- 加塌缩保险：一屏或一线里过门的比例为 0 而帖子数不少，不当作「没有相关内容」，当作门坏了，回退到一次便宜模型的批量判断（见下面第 2 点）或按互动取前几条。BestBlogs 的次序可以直接用：便宜模型只看前 200 字加元数据，`value ≥ 30` 才往后。
- 想要真正跨语言的本地门，需要多语言嵌入：BGE-M3（MIT，自述 100 多种语言、8192 token）；X-Timeline-Curator 用的英文 MiniLM 做不到。成本是模型体积，iOS 上不现实，桌面采集端才可行，而且读 X 本来就只在桌面。不急。

### 2. 305 条只出 3 件，大量推广和职业焦虑帖

- 账号白名单最强（follow-builders）。88 现在写「不做 X 账号名单」，这条值得重新讨论，见末尾开放问题。
- 明写的负例：跳过无评论转推、推广、「great event」、刷互动、给自己做广告的课程和路线图（follow-builders 的规则、BestBlogs 的 8 个示例）。「如果我有 6 个月成为 AI 工程师」这类是典型的「路线图型」，要进负例。
- `source_proximity` 四档枚举（my-focal-ai，只借思路）：原创、实现、转述、噪音。让模型直接标，不让它写长理由。
- 互动要按曝光归一：小号荐论文互动近 0，我们 88 里已经处理。twitter-cli 把书签权重定得最高（5 对赞 1），书签是比赞更强的「想回头读」信号；搜索页 DOM 是否带书签数没核实。
- 站点级过滤要有早停：ai-news-brief 在「一屏新帖全部低于阈值」时当场停。我们每线要读满几十屏，应加「连续 N 屏过门率低于某值就停」，省的是人速的时间。
- 泛词要靠锚词：「AI engineer」类的帖子是因为泛词命中。要求命中两个具体锚词，或把泛词放进否定词。

### 3. 中文主题，英文为主的源：怎么写 X 查询

X 搜索是关键词匹配，不是语义匹配，所以查询要用英文行内术语，中文只作辅助。运算符清单来自 [igorbrigadir/twitter-advanced-search](https://github.com/igorbrigadir/twitter-advanced-search)，页内各条的「最后核对」日期在 2022 到 2024 年，所以每个在第一次 run 里都要实测。

| 目的 | 写法 | 说明 |
|---|---|---|
| 只要带链接的帖 | `filter:links` | 包含媒体链接，`-filter:media` 排除 |
| 论文指针 | `url:arxiv.org`、`url:alphaxiv.org`、`url:huggingface.co` | 域名匹配；连字符要写成下划线；t.co 的短链和被截断的网址会让按网址搜索不可靠（一条搜索摘要里引的研究这么说，没核对原文） |
| 去噪 | `-filter:replies -filter:retweets` | 我们已有 `-filter:retweets` |
| 信号门槛 | `min_faves:N`，英文高、中文低 | ai-news-brief 用 1000 和 200（全站级）；主题级要更低，需要实测；可按语言分档，`(lang:en min_faves:50) OR (lang:zh min_faves:10)`（来自一篇第三方指南，非官方） |
| 语言 | `lang:en`，`(lang:zh OR lang:en)` | 自动识别，不一定准 |
| 时间 | `since:`、`until:`，`within_time:2d` | `since` 含、`until` 不含 |
| 串线程 | `filter:self_threads`、`conversation_id:<id>`、`quoted_tweet_id:<id>` | 引用链和线程 |
| 上限 | 查询里运算符约 22 到 23 个 | 页内自述 |
| 已不可用 | `near:`、`within:`（位置） | 第三方工具说已失效 |

起草时由模型出的是：一组英文术语词（行话和论文标题写法）、必要的中文词一条、锚词、否定词。运算符由程序拼，不让模型写运算符（last30days 的提示词也禁止模型发明 X 运算符）。过门阈值按语言分开，从实测里调。

### 4. 人速读取：115 分钟读 305 条，别人怎么做

| 项目 | 做法 | 速度 |
|---|---|---|
| twitter-cli | 每个请求约 20 条，间隔 2.5 秒乘抖动，单次最多 200 条 | 按间隔推算每分钟数百条 |
| ai-news-brief | 真浏览器，`scrollTo` 到底后等 2 秒，每词至多 20 次滚动，被限就整条放弃 | 按等待推算每分钟几十条 |
| twikit 指南 | 请求间 5 到 10 秒，搜索间 10 秒，批间 60 秒，限流后等 15 分钟 | 保守 |
| Scweet | 读响应头，离限额还差 2 个请求就停；单号每天几百到几千条 | 靠限额不靠时间 |
| twitter-web-exporter | 完全靠用户自己滚，脚本不动 | 人速 |
| 我们 | 按字数算停留，一屏最多 3 分钟，段间休息 | 每分钟约 2.7 条（这次实测）到 3.8 条（88 的估算） |

没有哪个项目公开过「多快会被封」的数据，只有各自的自述。我们的情形和它们不同：真浏览器、用户家的住宅 IP、自己的 cookie，没有 TLS 指纹和 `x-client-transaction-id` 这些伪装问题，这些恰恰是 API 路线容易被识别的地方。所以更可能被识别的是行为（速度和规律）而不是来源，这是推测，没有数据。

我们的预算花在了「每条帖都读一遍」，而不是「每一屏里有多少值得读的」。调法按收益排：

1. 把信号写进查询，一屏的有效帖数多几倍（第 3 点）。
2. 用旁听 GraphQL 取代永久链接页（下一节第 6 点），省掉每条截断帖开一页的时间。
3. 早停（第 2 点）。
4. 最后才是调停留时间。这条要用户定风险，见开放问题。

### 5. 主题漂移到符号回归；真正要的是「机制发现的自驱闭环实验」

真正的主题是一个概念，不是一个关键词：自动化实验闭环里的机制发现，先验怎么进来，和 AlphaGo、AlphaZero、AlphaFold 的类比。关键词搜出符号回归，是因为「discovery」「equation」「mechanism」这些词在那一带最密。

漂移和覆盖的做法（判据表、迭代改写查询、金标集）另见[开源主题情报与研究代理项目调研](./开源主题情报与研究代理项目调研.md)，这里只补 X 侧的几条。

别人的办法：

- last30days：每条子查询都带消歧限定词，并写进 `ranking_query`；强制按「主查询加 1 到 4 条子查询」。我们的 `anchors` 是同类机制，但锚词本身偏了就没用。
- STORM：先读同类主题的已有文章，发现不同视角，再定提问。对应到我们：起草前加一轮「摸底」，用 `web_search` 和 arXiv 看这个领域有哪些专有名词和分支，再写查询。
- 种子驱动：先从几件公认的代表作和机构的名字起手（我的记忆里有 A-Lab、Coscientist、FutureHouse、Periodic Labs 这一类，只作示例，须起草时现查并让用户确认），查询写成这些名字加概念词的组合。从一篇论文雪球式往外找：`url:` 指向它的帖，再看这些帖的作者还提了什么。
- 否定词：把已经证明漂移的词（`-"symbolic regression"`）写进主题的 `avoid`，程序拼进 `-"…"`。
- 漂移检测：88 已有「锚词未命中率过半」当攒着问的来源。加一项「第一屏就抽 3 条样本给用户看」，在第一次 run 的头几分钟让用户纠正，比跑完 115 分钟再纠正便宜。这条属于「对话是纠错界面」，不加新界面元素。

### 6. 帖子多半是论文指针，别人怎么收原文

- 旁听 GraphQL（twitter-web-exporter）：响应里的 `legacy.entities.urls[].expanded_url` 就是展开后的链接，`note_tweet` 是全文，`quoted_status_result` 是引用帖，`card` 是链接卡片。twscrape 的 `TextLink` 同时留 `url`、`display_url`、`t.co` 三样。我们现在 88 里要开永久链接页或另行展开 t.co（坑 657），旁听之后这一步多数不需要。
- smaug 的链接下一步：按域名分流，GitHub 走 API 取 star 和 README，文章取正文，X Article 取全文；书签不是原作者所发时，去搜原作者那条。我们 88 的「看原文」已经是这个形态，缺的是「帖子是转述时去找原作者原帖」。
- 论文要认全：arXiv abs、pdf、html、alphaxiv、HF papers、DOI 都归成同一个键，我们已做（`link-identity.ts`）。
- 小号荐论文的帖互动近 0，从热度排会丢。查询里用 `url:arxiv.org` 加语言和日期窗，不靠 `min_faves`，另开一条低门槛、只收「带论文链接」的线。
- Hugging Face 论文搜索和 Daily Papers 已接，是和 X 并行的第二条发现路；Emergent Mind 没有公开方法，不可复制。
- X Article：bird 和 twitter-cli 都能取全文并导出 Markdown，这两个做法靠 API；旁听 GraphQL 时 Article 在响应里是否有全文没核实，要做 spike 时一并看。

## 取舍表

### 现在就做

| 做法 | 成本 | 来源 |
|---|---|---|
| 门对着英文锚词和 `x` 搜索词算，不读 `ranking`；起草时让模型同时写英文版 `ranking` | 小：一处改动加测试 | 第 1 点，last30days 的字段分工 |
| 过门全零的塌缩保险：回退到便宜模型批量判断，或按互动取前几条 | 小 | 第 1 点，BestBlogs 两段式 |
| 查询拼接：`filter:links`、`-filter:replies`、`lang`、按语言的 `min_faves`、`url:` 论文线、否定词；运算符程序拼，模型不写 | 中：URL 构造和起草提示词，第一次 run 实测每个运算符 | 第 3、5 点，ai-news-brief、Scweet |
| 便宜模型批量分类：前 200 字、负例清单、`source_proximity` 四档 | 中：每约 40 条一次日常档调用 | 第 2 点，BestBlogs、follow-builders、my-focal-ai |
| 一线早停：连续 N 屏过门率低就停 | 小 | 第 2、4 点，ai-news-brief |
| 从这次的 305 条里标一个 100 条左右的金标，量门和分类的准确率 | 小：需要用户或 Sonnet 加人工抽查 | 没有项目公开过准确率 |

### 之后做

| 做法 | 成本 | 说明 |
|---|---|---|
| 旁听 GraphQL 响应取全文、展开链接、引用、计数 | 中到大：一次 spike 先验三件事（隐藏 webview 里能否在页面脚本之前装钩子，Tauri 有初始化脚本接口，当前用的版本要核对；Linux 和 macOS 都要验；X 的响应结构变化时的降级） | 收益最大，消掉永久链接页、t.co 展开、截断三个麻烦；仍只是读用户自己浏览器收到的东西；见开放问题 2 |
| 起草前摸底一轮（STORM 式） | 中：多一轮模型加 `web_search` | 第 5 点 |
| 起草后第一屏抽样给用户看 | 小到中 | 第 5 点，走对话不加界面 |
| 账号种子：`from:` 或 `list:` 查询，按子方向有一小批权威账号 | 中；要改 88 的「不做名单」 | follow-builders 证明白名单最强 |
| 从种子论文雪球 | 中 | 第 5、6 点 |
| 「原帖是转述时找原作者那条」 | 小到中 | smaug |
| 多语言嵌入门（BGE-M3 一类） | 大：模型体积、桌面才能跑 | 只在词法门不够时再说 |

### 不做

| 做法 | 理由 |
|---|---|
| twscrape、twikit、Scweet、tweet-harvest、twitter-cli、Rettiwt 这类 cookie 加 GraphQL 客户端，账号池、烧号 | 条款、封号、指纹伪装要持续追；死的和被点名的都在这一族；Agent-Reach 自己也建议用小号 |
| Nitter、RSSHub X 路由 | AGPL，Nitter 已被律师函和存档，不稳 |
| X 官方 API 按量付费 | 第三方说读一条约 0.005 美元，一次 305 条约 1.5 美元，成本不大，但和「用户自己的登录态」这条产品立场不同；有用户自己的 key 时可作选配，不做默认 |
| xAI `x_search` 当主路 | 第三方说单次约 45 秒、每千次 5 美元，没读到官方参数页；last30days 把它当一路后端，可作选配 |
| Bouncer、my-focal-ai 的代码 | AGPL 和 NC，只借思路 |
| 本地小模型全量过滤每条帖 | Imbue 自述比喻会让它出错，我们的模型调用已有日常档，不需要 |

## 开放问题

1. 旁听 X 自己的 GraphQL 响应，算不算 88 硬规则 2 的「只读、开页面是导航、不点按钮」之内？它不发任何额外请求，只读页面自己收到的内容，但比读 DOM 更「程序化」。
2. 速度要不要放：主号的封号风险，你接受到哪一档？没有公开数据，所以放多少只能靠自己小步试，并记录每次的限流和验证信号。
3. 88 写「不做 X 账号名单」。主题搜索里加一小批按子方向的权威账号，用来做 `from:` 查询，算不算越界？
4. 这个主题里中文帖占多少？只写英文查询，还是加一条 `lang:zh` 线？
5. 起草后第一屏抽样给你看，你愿意在对话里回一句吗？还是继续让它全跑完？
6. 有 xAI key 的用户，要不要把 `x_search` 做成「第二意见」的选配？
7. 金标谁来标？

## 没查完的

- X 官方对第三方 API 价格、`x_search` 的参数页，没读到原文，价格全是第三方的说法。
- 书签数是否出现在搜索页 DOM 上；X Article 的全文是否出现在旁听到的响应里。
- twikit 的 issues 和 twscrape 的 issues 没逐条读，维护状态以仓库页和 scrapfly、xpoz 两家厂商博客（卖竞品数据服务，口径偏向）为准。
- smol-ai 的 X 选源、Emergent Mind 的排序、ML-Papers-of-the-Week 的选法、Cocoon 的仓库，都没拿到。
- 各运算符在今天的 X 上是否仍有效，只有 igorbrigadir 清单的历史核对日期，没有实测。

## 来源

- [4 Best Open-Source X Scrapers on GitHub in 2026（Scrapfly，2026-10-08）](https://scrapfly.io/blog/posts/best-twitter-scrapers-github)
- [Open-Source Social Scrapers That Still Work 2026（Xpoz，厂商博客）](https://www.xpoz.ai/blog/guides/open-source-social-media-scrapers-what-still-works-2026/)
- [Nitter 被律师函（TechCrunch，2026-08-25）](https://techcrunch.com/2026/08/25/x-sends-cease-and-desist-to-open-source-project-nitter-over-alleged-scraping/)、[Privacy Guides](https://www.privacyguides.org/news/2026/08/26/x-com-sends-privacy-frontend-nitter-a-cease-and-desist-permanently-shuts-it-down/)
- [snscrape issue 列表](https://github.com/JustAnotherArchivist/snscrape/issues)
- [bird 分叉 geekavan/bird 的 README](https://github.com/geekavan/bird)、[@steipete/bird npm](https://www.npmjs.com/package/@steipete/bird)
- [twikit 账号保护文档（镜像）](https://mintlify.wiki/d60/twikit/advanced/account-protection)
- [igorbrigadir/twitter-advanced-search](https://github.com/igorbrigadir/twitter-advanced-search)
- 各项目仓库：见上表链接；源码核对过的是 twitter-web-exporter、twscrape、Scweet、ai-news-brief、bouncer（README 和部分源码）
- [Analysis of Leading Communities Contributing to arXiv Information Distribution on Twitter](https://arxiv.org/abs/2112.08073)、[TweetPap](https://arxiv.org/abs/2106.07213)
- [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)
