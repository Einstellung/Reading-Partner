# 舆情监测 agent 调研

2026-10-13。用户关心某些领域，但不想自己去 X、微博等平台刷，想要 agent 按话题替他去各平台搜新闻和舆情。这份看的是 GitHub 上现成的这类 agent 项目，英文生态 12 个、中文生态 13 个。星数和日期取自 2026-10-13，只读了 README 和源码。

我们 info 侧现在是"先拉源、再筛"，这批项目补的是"按话题去平台里搜"：拿到话题先查出该盯哪些账号、subreddit，再去各平台的搜索接口里找人在说什么。最接近需求的有几个。英文这边是 last30days（按话题搜各社交平台，有 watchlist 和增量库）、ai-research-arm（固定盯 AI 领域，无人值守跑了九个月，状态逐日累积）、openmagpie（用一句自然语言写清"什么算相关"，对一组源持续逐条判分）。中文这边是 yupi-hot-monitor 的形态（关键词列表、定时主动搜、逐条判相关性、过阈值才推送）、opencli-admin 的基础设施（定时、登录态浏览器采集、内容哈希去重、AI 打标签、推送）、OpenCLI 的登录态浏览器适配器。BettaFish、gpt-researcher、sona 这类一次性出报告的盯不住，没有跨次状态。从热榜出发再过滤的系统（hmmnxkl、MindSpider、news-aggregator）进不了细分领域，热榜只收大众话题。这批项目的取数路线，尤其是 OpenCLI 和 xiaohongshu-mcp 在登录态浏览器里读搜索页，和已定的"桌面端登录态 webview 低频只读"是同一条路，见 [AI信息筛选调研](./AI信息筛选调研.md)。

## 英文生态

### 1. last30days-skill（mvanhorn）

64,101 星，最近提交 2026-10-11，MIT。一个 Claude Code / Codex skill：给一个话题，并行去十几个平台搜最近 30 天的内容，按点赞、投票和下注金额打分，由宿主 agent 写成一份简报。

- 怎么说关心什么：每次给一句话题，例如 `/last30days Peter Steinberger`。要持续盯，就用 `watchlist.py add <topic> --queries ... --schedule <cron>` 存进去，默认每天 8 点。另有 discovery 模式（"what's exploding in AI agents"），会先扫 Reddit 分类列表、HN 首页、Digg AI 1000，提名 5–10 个正在升温的话题。
- 怎么搜：
  - 零配置就能用的：Reddit 靠匿名 RSS、shreddit 页面抓取和第三方存档 arctic-shift（Reddit 公开 .json 已经被封）；HN 走 Algolia；还有 Polymarket 和 GitHub。
  - X 有多个后端：默认 bird，是仓库自带的 GraphQL 客户端，读浏览器 cookie 里的 AUTH_TOKEN/CT0；其余是 xAI API、官方 X API、xquik，以及 Grok CLI（需要手动指定）。
  - TikTok、Instagram、LinkedIn、Threads 走付费抓取商 ScrapeCreators；Amazon 走 Bright Data；YouTube 用 yt-dlp。
  - 条款风险高：cookie 调 GraphQL、第三方存档、付费抓取商三类都有。
- 工作流：一个宿主 agent 加一个确定性引擎。
  1. agent 先查话题是不是"关键词陷阱"（同名、常用词）。
  2. 用宿主的 WebSearch 把话题解析成 X 账号、subreddit（包括同类社区）、GitHub 账号或仓库、Trustpilot 域名。
  3. agent 自己写查询计划 JSON：子查询、ranking_query，同名风险高的必须在每个子查询里加上限定词，比如写 "kevin rose digg founder" 而不是 "kevin rose"。
  4. 引擎按（子查询, 源）并行取数，然后：本地词重叠算相关度；LLM 重排，结果里没提到主实体的扣 25 分；加权 RRF 融合，超出 30 天窗口的一律排到窗口内结果后面；聚类去重。
  5. 源返回太少就补搜一轮：Reddit 免费路径不足 5 条时用 ScrapeCreators 补。
  6. 由 agent 按 synthesis.md 写成稿，交付前跑一遍自检。
  7. Grok 返回的推文会从推文 ID 里解码出发帖时间，核对是否在窗口内。理由是模型检索会编出格式完好、实际不存在的推文。
- 输出与开销：Markdown 或 HTML 简报，带各源的互动数字。README 说一次对比类查询约 3 分钟。每日预算闸默认 5 美元，超了就跳过这个话题。
- 能否持续跑：加 `--store` 后写入 SQLite（FTS5 全文检索，URL 去重）。同一 URL 再次出现时更新它的互动数，并记一次"再现"。`watchlist delta` 给出新增和更新条数，有新内容时发 Slack 或 webhook；`briefing.py` 汇出日报、周报的数据，再由 agent 写成文字。仓库本身不装定时器，cron 要用户自己配。
- README 与代码不一致："Zero config" 只对 Reddit、HN、Polymarket、GitHub 成立；X 实际要浏览器 cookie 或付费 key。"AI agent judge" 指的就是宿主 agent，不是独立的判官。
- 源码拆解见 [last30days拆解](./last30days拆解.md)。

### 2. ai-research-arm（ARA，guzus）

13 星，MIT，完整历史（2026-01-14 到 2026-10-13 共 11,056 个提交）。领域固定为 AI，号称从 2026-01 起无人值守运行。实际是 35 个 GitHub Actions workflow 组成的"自己写自己的报纸"。

- 怎么说关心什么：没有对话入口，靠维护几份清单：X 账号清单 `twitter_accounts.json` 加 7 个 X 搜索词、RSS 和专家博客注册表、3 个 subreddit。账号清单有一条每周的 explorer 流程找新账号，优先"已在盯的账号为它背书过的"，同时要在 AI 话题上而不是只是热门，证据够就开 PR 等人审。这条流程只在 06-20 到 06-30 合进过 4 个 bot PR，之后名单的大改动是人手做的。
- 怎么搜：
  - X 用 Birdy，只读、靠 cookie（BIRD_AUTH_TOKEN/CT0），有封号和条款风险。
  - HN 走 Algolia；Reddit 走 RSS；Bluesky 走公开 API；arXiv 走 Atom；YouTube 走 tuber。
  - 每天两次用 Exa 或 Perplexity 的 MCP 做大范围扫描。
  - 模型通过 claude-code-action 加 Claude 订阅的 OAuth token 调用，每条流程用哪个模型写在 `data/agent-backends.json` 一个文件里。
- 工作流：
  - 聚合：各源 2–6 小时一次，写成 markdown 提交进 git。
  - 合成：每天 00:00 UTC 出全源日报，日报本身不读昨天的日报；Twitter 分析员的提示词里带昨天的 Twitter 文件和当天已写的段落，`ai-news-research` 读昨天的 ai-news。
  - 模型发布时间线：每个发布、融资或诉讼一张 ticket，每天只增删改，不重新生成。
  - wiki：从当天日报累积。
  - 自审：每周审一遍自己的方法，提 PR 修。
  - 快讯去重：先由程序判完全相同、同 URL、跨源 Jaccard ≥ 0.5 三种情况；Jaccard 在 [0.35, 0.5) 的"争议带"才交给 Opus 判（`twitter-judge` lane）。只有判官给出 HIGH 置信度的"重复"才压掉，判官出错或缺结果时一律照发。判决按 URL 对号，不按数组下标。
- 输出：日报带 TTS 音频；头版是确定性的 SVG 转 PNG，渲染路径里不用模型；还有模型时间线、wiki、长文和 Telegram 快讯。仓库里找不到成本数字。
- 能否持续跑：能，这是它的本职。状态全在 git 里。
- README 与代码不一致：没有发现明显夸大。
- 源码拆解见 [ai-research-arm拆解](./ai-research-arm拆解.md)。

### 3. worldmonitor（koala73）

88,328 星，2026-10-12，AGPL-3.0。实时全球情报看板：地图加新闻加市场，地缘政治方向。

- 怎么说关心什么：选站点变体（world、tech、finance、commodity、energy、happy），关注若干国家，设告警规则（敏感度、摘要频率、推送渠道）。不能输入任意话题。
- 怎么搜：`feeds.ts` 里约 733 条手工整理的 RSS，加审核过的 Telegram 频道、X 新闻账号面板，以及 GDELT、ACLED、Polymarket 等结构化 API。API、MCP 和数据导出是付费 Pro 功能。
- 工作流：
  - 标题两两比词重叠，超过 0.6 视为近重复并合并，然后摘要。摘要依次尝试 Ollama、OpenRouter、浏览器内 T5。
  - 故事追踪按提及次数和首见时间分四个阶段：breaking、developing（2 小时内）、sustained、fading（沉默 24 小时）。
  - 摘要推送是 Railway 上每 30 分钟一次的定时任务：按用户规则取时间窗内的故事，滤掉 fading 和不够敏感度的，按分数排序，附上用户画像让 LLM 写。
  - 国家简报用"别名负匹配"：标题里另一个国家的别名出现得比目标国家早，就排除这条。
- 能否持续跑：能，但个性化推送依赖 Convex、Upstash Redis 和 Railway，自托管很重。
- README 与代码不一致："Local AI — run everything with Ollama, no API keys" 只对看板成立，推送和画像这一半是托管基础设施。

### 4. Crucix（calesthio）

12,105 星，2026-05-20，AGPL-3.0。"个人情报终端"：每 15 分钟扫一遍 27 个开放数据源，有变化就推送到 Telegram 或 Discord。

- 怎么说关心什么：用户没法设。查询词写死在各个源文件里，例如 Bluesky 搜 `'Iran war OR missile strike OR sanctions'`。
- 怎么搜：大部分是政府和开放 API（FRED、ACLED、FIRMS、OpenSky 等）。社交部分：Reddit 要注册 OAuth 应用；Telegram 抓 `t.me/s/` 公开预览页；Bluesky 走公开 searchPosts。
- 工作流：
  - 每次扫描和上一次比，数值指标按百分比阈值、计数指标按绝对阈值判变化，得到差异。
  - 新信号先过两道：重复抑制按出现次数递增冷却（0/6/12/24 小时）；再过文本哈希去重。
  - 交给 LLM 判档：FLASH、PRIORITY、ROUTINE。每档有自己的冷却和每小时上限（FLASH 5 分钟、6 条/小时）。LLM 不可用时退回规则判档。
  - 交易点子的提示词里带上次的点子，要求不重复。
- 能否持续跑：能。最近 3 次扫描放热存储，其余放冷存储。
- README 与代码不一致：注释里写的 "semantic dedup" 实际只是哈希：小写、去掉时刻、数字换成 NUM，4 小时窗口。"Zero cloud" 与默认可选的云端 LLM 相矛盾。

### 5. gpt-researcher（assafelovic）

30,056 星，2026-10-10，Apache-2.0。一次性深度研究报告。

- 怎么说关心什么：一个问题。
- 怎么搜：
  - 检索器可以换：默认 Tavily，另有 Exa、Serper、Brave、Bing、Google、SearX、DDG、arXiv、S2、OpenAlex、PMC、MCP。
  - X 走第三方 API xquik（自称每条推文 0.00015 美元）或 getxapi，有条款风险。
- 工作流：
  - planner 把问题拆成子问题，执行器并行搜索和抓取，经上下文过滤后由 writer 成稿。
  - Deep Research 是一棵树：默认宽 4、深 2，每个节点抽出"learnings 加追问"，再拿追问递归。
  - 另有 LangGraph 多 agent 版：editor、researcher、reviewer、reviser、writer、publisher。
  - 上下文过滤默认用 TypeSafe 的 Jev（要付费 key）。自测 28 个任务：保留下来的段落 73% 相关，嵌入法是 46%；没有 key 时退回 BM25。
- 开销：普通报告约 0.115 美元，写作约 45 秒；Deep Research 约 5 分钟、0.4 美元（o3-mini high）。
- 能否持续跑：不能。跨次运行没有状态，定时重跑每次都从零开始。open_deep_research（12,681 星，MIT）和 STORM（31,617 星，MIT）是同一形态，没有展开看。

### 6. openmagpie（obris-dev）

65 星，2026-10-06，Apache-2.0，`ee/` 目录除外（目前不存在）。自托管 social listening：替你盯帖子，只把符合你描述的推给你。

- 怎么说关心什么：
  - feed：一组源，可以是 subreddit、X 查询或账号、YouTube、HN、RSS，带保留期。
  - watch：一句自然语言判据（例如 "someone frustrated with manual social monitoring and asking for alternatives"）加一个阈值，再接一串动作（发 webhook、写日志、汇成摘要）。
  - 也可以让 AI 助手问你几轮，替你生成配置。
- 怎么搜：X 用 twikit（cookie，非官方，可挂代理）；Reddit 读 `/r/<sub>/new/.rss`，注释说匿名 .json 被 TLS 指纹拦了，也可以用 OAuth 应用；其余走官方或公开接口。
- 工作流：本地或任意 OpenAI 兼容的 LLM 给每条新帖打分并写理由，分数达到阈值才进入后面的动作，否则就停。四个阶段各自独立定时：拉 feed、触发 watch、执行、合并摘要。7B 模型每条 1–3 秒。
- 能否持续跑：能，这是它的设计目标。

### 7. harken（VladUZH）

36 星，2026-07-22，MIT。Brand24 的自托管小号：盯一个关键词，看大家怎么说。

- 怎么说关心什么：关键词，可以归组成项目。
- 怎么搜：
  - 默认零 key：HN 和 Bluesky。
  - 配置后可用：Reddit、Mastodon、Stack Overflow、RSS、YouTube，以及 X 官方 v2 recent search（要 bearer token）。
- 工作流：统一成 Mention 结构，按内容哈希去重。情感用词典法算，LLM 可选。主题按共有关键词聚类。结果存 SQLite，带看板。没有 LLM 相关性判断，同名词会很吵。
- 能否持续跑：`harken watch --every 900` 定时跑。每个（关键词, 源）各有一个向前追新游标和一个回填历史游标，游标在数据入库后才提交；回填拿到的历史条目不触发告警。

### 8. obsei

1,435 星，2026-10-09，Apache-2.0。1.0 版重写后转向私有部署的客户声音分析（工单、评论、调研），讲隐私和 PII 脱敏，已经不是对外的舆情发现工具。

- 怎么说关心什么：`obsei.yaml` 里配源。
- 怎么搜：HN 走 Algolia search_by_date，另有 Bluesky、YouTube、RSS、GitHub issues、应用商店。Reddit 只是未发布的社区插件，Twitter 已经移除。
- 工作流：分类可以用小型判别模型或 LLM，带置信度；低置信的升级给强模型或人工。之后做主题聚类。
- 值得借的接口：源接口是 `fetch(cursor) -> (record, cursor)`，游标只在最后一条记录交出时才推进到最新时间戳。
- 能否持续跑：`obsei serve` 定时跑。

### 9. trendFinder（ericciarla，Firecrawl）

4,120 星，最近提交 2025-02-17（已停更），MIT。

- 怎么说关心什么、怎么搜：源写死在 `getCronSources.ts`：7 个网站走 Firecrawl `/extract`，1 个 X 账号走官方 recent search，只取 24 小时内的。
- 工作流：一次 o3-mini 调用，让模型"写一篇要点帖"，结果推到 Slack 或 Discord。
- 能否持续跑：定时器代码被注释掉了。
- README 与代码不一致：README 说能"检测新兴趋势"、支持 Together、DeepSeek、OpenAI。代码里只有 OpenAI，没有趋势检测，没有状态，也不去重。X 免费档每 15 分钟只够盯 1 个账号。

### 10. MorningAI（octo-patch）

33 星，2026-05-16，没有 LICENSE 文件。buildwithclaude 技能集里写着 MIT，3.6k 星是那个技能集的，不是它的。

- 怎么说关心什么：AI 日报，在 `entities/*.md` 里列了 80 多个实体，可以自加。
- 怎么搜：Reddit、HN、GitHub、HF、arXiv、X。X 的做法是调 Anthropic Messages API 的 web_search 工具，让模型自己找推文 URL。
- 工作流：先按元数据自动打分（相关 0.35、互动 0.30、源可靠 0.20，注释写明改编自 last30days），再由 agent 按五个维度定性评分。官方账号直接采信，个人账号要交叉验证。
- 输出：Markdown 报告、信息图、邮件。
- README 与代码不一致：写着 "No API keys required"，实际 X 那一路要 Anthropic key，而且推文是模型检索回来的，可靠性存疑。

### 11. news-agents（eugeneyan）

332 星，2025-07-19，MIT。一个实验：Amazon Q CLI 加 MCP 的 RSS 工具加 tmux。

- 工作流：主 agent 把 `feeds.txt` 切成三份，开三个子 agent 分别摘要，最后合并。
- 评价：没有话题过滤，没有状态。说明这类活用多 agent 并行没有实际收益。

### 12. Agent-Reach（Panniantong）

96,649 星，2026-10-08，MIT。作者来自中文社区。它不是监测工具，是取数层：给 agent 装好各平台的命令行工具，每个平台有首选和备选后端，带体检命令。

- X 只接受用户用 Cookie-Editor 手工导出的 cookie。
- Reddit 明说没有零配置路径：要么用 OpenCLI 复用 Chrome 登录态，要么 rdt-cli 加 cookie。
- 全网搜索走免费的 Exa MCP。

和我们"桌面端带登录态 webview 当采集端"的方向一致。

另有两个托管的"monitor"服务，不开源，可当付费备选：Parallel Monitor API 3–10 美元/千次，Exa Monitors 15 美元/千次，都能按时跟踪并回调 webhook。但它们搜的是网页，不是社交平台。

## 中文生态

| 项目 | 星 | 最近提交 | 许可证 | 一句话 |
|---|---|---|---|---|
| 666ghj/BettaFish（微舆） | 42.4k | 2026-10-02 | GPL-2.0 | 问一句话，几个 agent 搜索、讨论，写成长篇舆情报告 |
| NanmiCoder/MediaCrawler | 66.7k | 2026-10-10 | 非商业学习许可 1.1 | 七个国内平台的关键词、帖子、评论爬虫，不含 AI |
| xpzouying/xiaohongshu-mcp | 16.2k | 2026-10-09 | Apache-2.0 | 用登录态无头 Chrome 操作小红书，以 MCP 工具提供给 agent |
| jackwener/OpenCLI | 30.1k | 2026-10-13 | Apache-2.0 | 在用户已登录的 Chrome 里跑 100 多个站点适配器，给 agent 用 |
| xjh1994/opencli-admin | 125 | 2026-04-18 | Apache-2.0 | 在 OpenCLI 上加定时采集、去重、AI 打标签和推送 |
| liyupi/yupi-hot-monitor | 718 | 2026-04-16 | 无 | 填关键词，每 30 分钟搜一轮，AI 判断相关性后推送（教学项目） |
| hmmnxkl/LLM-Based-…-Assistant | 716 | 2026-04-07 | MIT | 爬 26 个热榜存库，对话查询，每天定时推送专题报告 |
| beingaigital/sona | 17 | 2026-04-16 | MIT | LangChain ReAct 舆情 agent，数据来自商业舆情平台 |
| cclank/news-aggregator-skill | 1.3k | 2026-05-28 | 无 | Claude skill，从 44 个以上的源拉新闻，生成中文简报 |
| kunhai1994/xhs-research | 44 | 2026-03-29 | MIT | Claude skill，基于 xiaohongshu-mcp 做小红书调研报告 |
| minsight-ai-info/AI-Search-Hub | 1.3k | 2026-04-27 | 无 | 用 Playwright 去问豆包、元宝、Grok 等的网页版，借它们的搜索 |
| AiyaFun/beacon（烽火台） | 48 | 2026-09-20 | AGPL-3.0 + 商业授权 | 面向创作者的热榜、竞对监控、每日选题平台，带桌面采集端 |
| iniwap/AIWriteX | 2.1k | 2026-09-17 | Apache-2.0，README 另加非商用条款 | 抓热榜，用 CrewAI 写公众号文章 |

### 1. BettaFish（微舆）

- 用户怎么输入：在网页上用自然语言提一个分析问题。没有关注列表，也没有订阅。
- 怎么取数：
  - Query 引擎调 Tavily 新闻搜索，有基础搜索、深度搜索、近 24 小时、近一周、按日期区间、图片几种。
  - Media 引擎调博查或安思派的 AI 搜索 API（付费 key）。
  - Insight 引擎只对本地 MySQL/PG 做 `LIKE` 查询，库里的数据由 MindSpider 预先爬好。
  - MindSpider 是独立的一步：先从 newsnow 公共实例拉 12 个热榜，让 DeepSeek 抽出最多 100 个关键词，再把这些词交给 MediaCrawler 去爬小红书、抖音、快手、B 站、微博、贴吧、知乎。爬虫要扫码登录，每个词默认最多 50 条。
  - 需要配置 7 套 LLM key，外加 Tavily、博查或安思派、数据库。
- 工作流：三个引擎并行跑，每个引擎的步骤相同：
  1. LLM 先列出报告段落结构。
  2. 每段先搜一次、写一段总结。
  3. 反思循环 `MAX_REFLECTIONS=2`：LLM 给出下一个搜索词、要用的工具和日期范围，再搜一轮。这就是它"再搜一轮"的机制。
  - 所谓"论坛"是 ForumEngine 盯着三个引擎的日志文件，每累积 5 条 agent 发言，主持人 LLM 发言一次；各引擎写总结时把最新的主持人发言读进 prompt。
  - Report 引擎按"选模板 → 版式 → 字数预算 → 逐章生成 JSON 中间表示 → 渲染 HTML/PDF"的顺序出报告。
  - 没有跨来源去重或交叉核实。
- 输出与成本：长篇 HTML/PDF/Markdown 报告。issue #444 有用户反映，用推荐模型完整跑一次花了 50 美元。耗时没查到数据。
- 能否持续：分析部分只能一次性出报告，没看到内置调度。MindSpider 要另外手动跑。
- README 和源码不一致的地方：
  - README 写"AI 爬虫集群 7x24 不间断作业、30+ 社媒"，实际是 7 个平台、手动启动。
  - "深度解析抖音快手短视频"的 Media 引擎，实际只是调搜索 API。
  - 爬虫的关键词来自当天热榜，不来自用户的问题。所以冷门话题在库里搜不到：issue #444 日志里全是"未找到"。issue #597 里，报告编造了一个不存在的微博用户和他的评论，项目的 bot 承认数据不足时约一半内容是编的（#377、#564）。
  - GraphRAG 合入后又回退了。

### 2. MediaCrawler

- 用户怎么输入：在配置里填 `KEYWORDS`、帖子 ID 或创作者 ID。
- 怎么取数：
  - 用 Playwright 登录（扫码、手机号或 cookie）。默认走 CDP 模式，直接接管用户已有的 Chrome，复用登录态。
  - 之后直接调平台的 Web 接口，例如小红书的 `edith.xiaohongshu.com/api/sns/web/v1/search/notes`，微博的 `m.weibo.cn` container 接口。
  - 支持代理池（快代理等），赞助商都是住宅 IP 代理商。
- 默认参数：每词 15 条，并发 1，间隔 2 秒。只输出 jsonl/csv/数据库，不含 AI，没有调度。
- 风险：封的是账号。README 自己要求只能小规模使用。
- README 和源码不一致的地方：README 说"无需 JS 逆向，靠浏览器上下文拿签名"，实际小红书用的是 `xhshow` 纯算法签名，抖音的 `a_bogus` 是用 execjs 跑 `libs/douyin.js` 算的，都已经是逆向方案。
- 许可证：非商业学习许可，代码不能搬。

### 3. xiaohongshu-mcp

- 用户怎么输入：由 agent 调用 MCP 工具，传关键词和筛选条件（排序可选综合、最新、最多点赞等）。
- 怎么取数：
  - Go 写的，用 go-rod 驱动无头 Chrome。首次扫码登录后保存 cookie。
  - 搜索就是打开搜索页，等 `window.__INITIAL_STATE__` 出现，直接读里面的 `search.feeds`。
  - 筛选靠模拟鼠标悬停、点击筛选面板，带 `humanize` 随机延迟。
  - 另有帖子详情、评论、用户主页，以及发帖、点赞等写操作。
- 风险：同一账号不能同时在别的网页端登录，否则会被踢下线。作者说一年没封过号（自述，未核实），但新号会被要求实名。
- 本身不含 AI，没有调度。

### 4. OpenCLI

- 用户怎么输入：agent 调用 `opencli <站点> search <关键词>` 这类命令。
- 怎么取数：
  - 用一个 Chrome 扩展加一个本地小 daemon，在用户已登录的 Chrome 里执行。
  - 微博、小红书、抖音、B 站、知乎、X、即刻等的 search 适配器都是 `Strategy.COOKIE`：打开站点的搜索页，抓 DOM。例如微博打开 `s.weibo.com`，读 `.card-wrap`。
- 小红书限流处理（`clis/xiaohongshu/risk-control.js`）：
  - 识别软封：跳转到错误码 300017/300031，或页面出现"安全限制"。
  - 遇到后随机冷却一段较长时间，只重试一次。
  - 注释写明了跨多次调用的总频率还没限制。
- smart-search skill 的调用预算：
  - 用户没指定网站时，先只问一个 AI 源（grok、doubao、gemini 三选一），不够再补 1 到 2 个专门站点。
  - 每题记一本调用台账：每个 AI 站点最多 1 次，其他站点最多 2 次，失败也算 1 次。
  - 回答末尾必须附"搜索摘要"，列出用了哪些站、搜了什么词、各几次。
- 没有调度。

### 5. opencli-admin

- 用户怎么输入：在界面上配置数据源，共五种渠道：opencli 命令（可带搜索词参数）、RSS、API、网页爬虫、CLI。
- 工作流：
  1. 按结构化 cron 定时执行。
  2. 归一化后用 SHA-256 `content_hash` 去重入库。
  3. 每条记录由 AI 做摘要、打标签。
  4. 推送到飞书、钉钉、企业微信、Webhook 或邮件。
- 多机部署：几台 Mac mini 各登一个账号，通过反向 WebSocket 注册到中心，按站点路由任务。
- 它是采集流水线，没有"围绕一个话题主动扩词、判断相关性"这一层。

### 6. yupi-hot-monitor

- 用户怎么输入：维护一份关键词列表，每个词可以启用或暂停。
- 工作流：cron 每 30 分钟对每个关键词跑一轮：
  1. 用 DeepSeek 扩写同义词。但扩出来的词只用于文本预匹配，真正搜索用的还是原词。
  2. 并行搜 6 个源：Twitter（twitterapi.io，第三方付费）、Bing 网页抓取、HN Algolia、搜狗网页抓取、B 站搜索接口、微博。
  3. 按归一化 URL 去重，再查库排除已有的。
  4. 每条交给 LLM 打分，给出是否属实、相关度 0–100、原文是否提到关键词、重要度、摘要。
  5. 过滤：不属实的丢掉；相关度低于 50 的丢掉；原文没提到关键词且相关度低于 65 的也丢掉。
  6. 通过 WebSocket 和邮件推送。
- README 和源码不一致的地方：README 说有"8+ 数据源"，实际定时任务只用 6 个。其中"微博"只是拉热搜侧栏 `weibo.com/ajax/side/hotSearch`，并不是按关键词搜索。
- 无许可证。

### 7. LLM-Based-Intelligent-Public-Opinion-Analytics-Assistant（hmmnxkl）

- 怎么取数：Scrapy 爬 15 个平台的 26 个热榜（百度、B 站、抖音、快手、头条、网易、腾讯、UC、澎湃、凤凰、微博、小红书、知乎等），存 MySQL，并把标题写进向量库。
- 对话查询：LangChain agent，工具有榜单查询、语义搜索、聚类、情感分析、正文抽取。
- 定时推送：
  - 用户设置一句话描述加每天的推送时间（HH:MM）。APScheduler 提前 10 分钟开始跑。
  - 先语义搜索取前 30 条，再做聚类，让 LLM 挑出最相关的一个簇。
  - 抽取这些条目的正文（视频页也抽），写成报告，推送到企业微信、Telegram 或邮件。
- 局限：只能在热榜里找。用户关心的领域没上热榜，就推不出来。
- README 的示例报告里有标题之外的细节（例如"Anthropic 靠企业级安全合规方案在 2026 财年…"），看起来是模型补写的。

### 8. sona

- 用户怎么输入：自然语言提问。
- 工作流：ReAct 依次调用这些工具：提取搜索词 → 估算数据量 → 采集 → 统计 → 时间线和情感分析 → 研判 → 生成 HTML 报告。
- 数据来源：采集全部走 `pro.netinsight.com.cn` 这个商业舆情平台。用 Playwright 拿账号登录，截获授权头后调它的 advancedSearch 接口，覆盖新闻、微博、微信、论坛、境外、Twitter、Facebook。网页搜索用博查。
- `/hot` 热点态势：每小时存一份热榜快照，根据过去 12 到 24 小时的排名变化算出上升或下降趋势。
- 只能一次性出报告。必须有付费数据账号。

### 9. news-aggregator-skill

- 用户怎么输入：选数据源，可加 `--keyword` 过滤。
- 工作流：`fetch_news.py` 从 44 个以上的源拉数据（HN、GitHub、HF Papers、华尔街见闻、微博热搜、36 氪，以及用户自己的 OPML），可选抓正文。之后由 LLM 按统一模板翻译、写摘要和点评，存到 `reports/日期/`。
- bug：关键词过滤用的正则 `\b词\b`，中文关键词夹在中文句子里匹配不上。
- `MISTAKES.md` 记了一条值得照做的教训：数据层的时间一律存完整日期时间，只存 `HH:MM` 会让模型把"昨天"当成"1 小时前"。
- 需要用户手动触发，无许可证。

### 10. xhs-research

- 用户怎么输入：一个调研主题。
- 工作流：
  1. LLM 从同义词、细分维度、正反面、小红书黑话、品牌等角度生成 5 到 8 个搜索词。
  2. 通过 xiaohongshu-mcp 并行搜索。
  3. 去重：先按 `feed_id`，再用字符三元组 Jaccard（阈值 0.6）去掉标题相近的，保留互动更高的那条。
  4. 打分：相关性 40%（覆盖率取 1.35 次方）、时效 25%、互动 35%（log1p 压缩，收藏权重大于赞大于评论）。
  5. 取前 20 条抓全文和评论。
  6. 写报告：每句都要带原帖链接，评论区比正文优先。
- 跑一次 1 到 3 分钟，一次性出报告。MIT 许可。

### 11. AI-Search-Hub

- 工作流：用 Playwright（独立浏览器档案，或接管已登录的 Chrome）去问 Grok、Gemini、豆包、元宝、通义、Kimi、MiniMax、LongCat 的网页聊天界面。`ROUTING.md` 按内容生态分派：X 问 Grok，抖音问豆包，公众号问元宝，本地生活问 LongCat。
- 不用付钱，但拿到的是别人模型转述过的结果，可能有幻觉；而且大概率违反这些服务的使用条款，账号有风险。
- 无许可证。仓库在给作者的商业产品 NotYet 引流。

### 12. beacon（烽火台）

- 热榜来源：自建 DailyHotApi、60s API、RSSHub、百度、YouTube。
- 竞对监控：抖音、小红书、B 站走 TikHub（付费），X 走 twitterapi.io（付费），公众号走新榜（付费），YouTube 走官方 API。
- 采集端：Tauri 桌面客户端和浏览器插件，用本机 Chrome 采集。
- 值得看的两处设计：
  - `lib/browser-task/read-allowlist.ts` 管"让登录态浏览器去打开服务端指定的 URL"。规则有三条：服务端和插件各硬编码一份同样的白名单；比对 origin 时要求完全相等；页面加载完后用最终 URL 再核一次，防止跳转逃逸。
  - `lib/hot/lifecycle.ts` 把热点分成上升、峰值、降温、消退四个阶段。
- 每天早上给一份选题推荐。AGPL 许可。

### 13. AIWriteX

- 热榜来源：知微数据趋势接口和 vvhan 热榜接口。
- 工作流：CrewAI 依次扮演研究员、作者、审核、设计，写公众号文章。
- README 和源码不一致的地方：README 宣传的"黑马挖掘、未来 12 小时趋势预测"，开源代码里找不到。
- GitHub 标的是 Apache，但 README 的 NOTICE 另加了非商用、不得对外提供服务的条款。它是写稿工具，不是阅读工具。

## 可借的与不适合的

### 可以搬代码的（MIT / Apache）

- last30days（MIT）：
  - 搜索前先解析：把话题解析成账号、subreddit（包括同类社区）、仓库，同名风险高的在每个子查询里加限定词。这一步适合在研究室章程建立时做一次，结果存进章程，由招募员定期复查，不必每晚都做。章程、招募员的定义见 [63](../info/63-情报局：研究室、专项组与态势.md)。
  - 排序：按（子查询, 源）分流后做加权 RRF；结果里没提到主实体的扣分；超出时间窗口的排到窗口内结果后面。
  - 增量：同一 URL 再次出现时更新互动数，分别计"新增"和"更新"。
  - 补搜：某个源返回太少（例如少于 5 条）才补搜一轮，补搜次数有上限。
  - 预算：每天的预算闸。
  - 推文时间核验：X 推文 ID 里编码了发帖时间，可以零成本核对模型或第三方返回的推文是否真的在时间窗内。
- ARA（MIT）：
  - 快讯三段去重：程序判完全相同、同 URL、高重叠；只把 Jaccard 0.35–0.5 的争议带交给便宜模型判；只有 HIGH 置信才压掉，出错一律照发，判决按 URL 对号。可以直接补进 [AI信息筛选调研](./AI信息筛选调研.md) 里 L1 去重之后。
  - 源清单靠"已在盯的源为它背书"扩，开 PR 由人审（实际只自动合进过 4 个 PR）。对应招募员加"add 那道闸"。
  - 实体 ticket 只增删改、不重新生成。对应态势里的判断记录。
  - Twitter 分析员读昨天的文件和当天已写的段落，续写多日脉络，不从头重报。
- openmagpie（Apache）：watch 就是"判据加阈值加理由"再接一串动作，四个阶段各自独立定时。可以给"粗筛只输出可观测项命中"补一个可解释的理由字段。
- obsei、harken（Apache、MIT）：源接口返回（记录, 游标），游标在数据入库后才推进；追新和回填各用一个游标，回填的条目不触发提醒。适合 info 源插件里需要增量拉取的那几个。
- gpt-researcher（Apache）：深挖树"learnings 加追问"递归，可以直接当 tasking 的展开方式；上下文过滤没有 key 时退回 BM25，可以借。
- xhs-research（MIT）：扩词 prompt；三元组 Jaccard 去重；相关性、时效、互动三项加权打分；报告"每句必带链接"的自检规则。
- OpenCLI（Apache）：微博、小红书、抖音、B 站、知乎、X 搜索页的 DOM 选择器；小红书软封识别加冷却重试；smart-search 的单题调用预算台账。
- xiaohongshu-mcp（Apache）：直接读 `__INITIAL_STATE__` 而不是解析 DOM；humanize 随机延迟。
- opencli-admin（Apache）：`content_hash` 去重；定时计划的数据模型。
- hmmnxkl（MIT）：先聚类、再让 LLM 挑相关簇的推送流程。

### 只借思路的（GPL / AGPL / 无许可证）

- worldmonitor：故事阶段只按提及次数和时间算出 breaking / developing / sustained / fading，不用模型；实体"别名负匹配"防串台。
- Crucix：
  - 重复信号按出现次数递增冷却（0/6/12/24 小时）。
  - 分档推送，每档有自己的冷却和每小时上限。
  - LLM 挂了退回规则判档。
  - 数值差异的阈值表，和 [63](../info/63-情报局：研究室、专项组与态势.md) 的数值序列短管是同一类东西。
- MorningAI：官方账号直接采信、个人账号要交叉验证。
- BettaFish（GPL）：每段写完让 LLM 反思，提出下一个搜索词、工具和时间窗。
- yupi-hot-monitor（无许可）：相关度阈值，加上"原文是否提到关键词"这道闸。
- beacon（AGPL）：登录态浏览器的 origin 白名单三条硬规则；热点生命周期四阶段。
- sona 用热榜排名变化算趋势。sona 是 MIT，代码能搬，但没什么必要。

### 不适合的

- 有条款风险的取数方式：cookie 调 GraphQL 的客户端（bird、Birdy、twikit）、第三方 X API（xquik、getxapi）、arctic-shift 和 ScrapeCreators、Bright Data 这类付费抓取商、AI-Search-Hub 去问别家模型网页版（结果是二手的）。和 [AI信息筛选调研](./AI信息筛选调研.md) 的结论一致：X 和需要登录的 Reddit 走桌面端登录态 webview 低频只读。
- MediaCrawler：许可证不允许搬代码，签名靠逆向、要配代理，封号风险最高。
- 重型自托管栈：worldmonitor 和 Crucix 的 Redis、Convex、Railway，它们的领域也写死了；BettaFish 要常驻 PG 服务，爬虫和分析分开。
- 用模型去检索推文：MorningAI 的做法。last30days 专门写了防编造的核验，说明这条路靠不住。BettaFish 在库里没数据时也会编造内容。
- 一次性的报告工具当监测用：gpt-researcher、STORM、open_deep_research、BettaFish（跑一次几十美元）、sona（还依赖付费舆情平台）、xhs-research，都没有跨次状态。
- 依赖付费数据：beacon 的竞对监控（TikHub、新榜）。
- 从热榜出发再过滤的系统（hmmnxkl、MindSpider、news-aggregator-skill）：热榜只收大众话题，用户的细分领域进不去。"盯领域"必须按话题主动去搜。
- 其余：AIWriteX 是写稿工具；trendFinder 已停更，内容只有一次摘要；news-agents 是玩具；harken 只用词典判情感、不判相关；obsei 1.0 已经换了方向。

### 和我们约束的对应

桌面 app 带 webview 和登录态，适合 OpenCLI / xiaohongshu-mcp 的做法：打开搜索页，读 DOM 或页面初始状态。桌面端定时跑采集，结果同步到 iOS 上阅读。每个平台只用一个账号，每个话题每天搜几次，频率要低。

iOS 端可以直接调不需要登录的搜索接口：HN Algolia、Bluesky 的 `public.api.bsky.app` searchPosts、Reddit 的 `/new/.rss`（只能按 subreddit 拉，不能搜，能不能用待验），YouTube 走 Data API。X 搜索、Reddit 搜索和国内平台放到桌面端，靠登录态 webview 在夜间跑。这样补上"按话题去社交平台搜"这一块，又不碰条款风险最高的几条路。

## 没查完的

- LangChain 的 Social Media AI Monitor 模板托管在 LangSmith，没找到公开仓库。
- open_deep_research 和 STORM 只凭已知形态带过，没有读源码。
- last30days 的 LLM 重排提示词，以及 discovery 模式怎么算升温速度，没细读。
- ARA 的实际花费：仓库里没有数字。
- openmagpie 合并摘要那一步的细节没看。
- stonedt-yuqing（传统舆情系统，GPL-3.0）、BettaFish-skill、SocialDataX 出的 weibo-mcp（第三方数据服务）没看。
- 各项目的实际耗时没有实测。

## 来源

- [ARA on Product Hunt](https://www.producthunt.com/posts/1187900)
- [LangChain Social Media AI Monitor](https://www.langchain.com/templates/social-media-ai-monitor)
- [Morning AI skill listing](https://skillselion.com/skills/davepoon/buildwithclaude/morning-ai)
- [World Monitor docs](https://www.worldmonitor.app/docs/about)
- [AGPL 3.0 World Monitor (OpenSourceForU)](https://www.opensourceforu.com/2026/07/agpl-3-0-world-monitor-makes-osint-accessible-to-all/)
- [Firecrawl trend finder blog](https://firecrawl.dev/blog/trend-finder-typescript)
- [Parallel pricing](https://parallel.ai/pricing)
- [Exa pricing (tinyfish)](https://www.tinyfish.ai/blog/exa-pricing)
- [Exa Websets billing](https://websets.exa.ai/billing)
