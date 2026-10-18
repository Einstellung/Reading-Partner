# Hugging Face 作为检索与发现源调研

2026-10-18。起因：主题搜索（[docs/info/88](../info/88-主题搜索.md)）的 arXiv 梯子在 2026-10-16 的第一次 run 里 6 条查询只找到 1 篇，export API 又被限流；想知道 Hugging Face（HF）能不能当检索源和每晚增量的发现源。实测用了 38 个无认证 GET（间隔 2.5 秒以上，带项目 User-Agent，没有 429），没碰 export.arxiv.org。标注：【官方】来自 HF 文档，【实测】来自这次请求，【三方】来自转载 HF 官方 skill 文档的第三方页面，【未证实】没验到。

## 结论

1. `GET https://huggingface.co/api/papers/search?q=<词>` 无认证可用，一个请求最多回 120 篇，按相关度排，混合语义和全文检索，多词查询不会像 arXiv export API 那样因 AND 而搜空。7 条子方向查询都返回 28 到 120 篇，arXiv 梯子整个主题只找到 1 篇。
2. 不是只有被人提交的论文。676 个结果行里 390 个 upvote 为 0，最老到 2012 年的论文；索引比 Daily Papers 宽得多。但也不是全 arXiv：梯子找到的那篇 2610.11059 在符号回归查询的 120 篇里没有，直接查 `api/papers/2610.11059` 回 404，文案说论文要被某个 repo 的 README 引用才会有页面。
3. 搜索没有日期、排序、翻页参数（`sort`、`since`、`skip` 实测被忽略，`limit` 只截断，上限 120）。日期窗只能客户端按 `paper.publishedAt` 过滤；这个字段不一定是 arXiv v1 日期，635 篇去重论文里 75 篇的月份和 arXiv 编号的年月不一致，其中 53 篇更晚。
4. 每个结果行已带 `githubRepo`、`githubStars`、`projectPage`、`organization`、`ai_summary`、`ai_keywords`、作者、`upvotes`、`numComments`。论文到代码这一层搜索结果自己就有，不用多发请求。
5. 论文到模型、数据集、Space：`api/papers/<arxivId>` 直接带 `linkedModels`、`linkedDatasets`、`linkedSpaces`（各只列前几个）和 `numTotalModels/Datasets/Spaces`；`api/models?filter=arxiv:<id>` 同样可用（Llama 2 实测 587 个模型）。AI Scientist v2 这类论文三项都是 0，所以这一层对多数论文是空的。
6. 趋势：`api/daily_papers` 支持 `date`、`week`（`2026-W41`）、`month`（`2026-09`）、`sort=trending`、`p`（页码，从 0 起）、`limit`；`https://huggingface.co/papers/trending` 页面就是 `sort=trending` 的 50 行，没有单独的趋势 API。模型、数据集、Space 用 `sort=trendingScore`。
7. 限额：匿名按 IP，API 500 次、页面 100 次，5 分钟固定窗口【官方】；搜索论文另有一个桶，实测 50 次/5 分钟，只在响应头里看到，官方文档没写。每晚几十个请求远在限内。
8. 现有 `huggingface` 插件只做 `daily_papers?date=` 按日取、模型和数据集榜；没有 `search`、`lookup`、`enrich` 槽，没读 `githubRepo`、作者、`ai_summary`，也没用 `sort=trending`。
9. 建议：HF 论文搜索做梯子的第一步（一个请求，窗口放宽不再发请求），arXiv 梯子照跑补缺，两边按 arXiv id 合并；arXiv 被限流或冷却时 HF 单独撑住。每晚增量用 HF 搜索加客户端日期过滤为主，`daily_papers` 流为辅。
10. 弱点：相关度尾部有噪声（"self-driving lab" 前 20 里只有约 5 篇相关，其余是自动驾驶）；HF 的收录有缺口和未量化的延迟；搜索没有日期过滤，热门老论文会挤掉新论文。

## 一、论文搜索

请求：`GET /api/papers/search?q=<词>&limit=<n>`。

| 项 | 内容 | 来源 |
|---|---|---|
| `q` | 最长 250 字符；混合语义和全文检索，搜标题、作者、内容 | 三方 |
| `limit` | 1 到 120，默认回 120；`limit=10` 回 10 条，内容是 `limit=120` 的前 10 条 | 三方，实测 |
| `skip`、`sort`、`since` | 加上后结果与不加完全相同，被忽略 | 实测 |
| 认证 | 不要 | 实测 |
| 响应大小 | 120 条约 650 到 900 KB（不压缩），`Accept-Encoding: gzip` 下 182 KB 的响应压到 44 KB | 实测 |

响应是数组，每行：

```
{ "paper": { "id": "2302.11223", "title", "summary", "publishedAt": "2023-02-22T09:10:20.000Z",
             "authors": [{"name", "hidden", "_id", "user"?}], "upvotes": 0, "discussionId",
             "ai_summary", "ai_keywords": [...], "ai_summary_model",
             "githubRepo"?, "githubStars"?, "projectPage"?, "organization"?, "mediaUrls"? },
  "publishedAt": "2023-02-22T04:10:20.000Z", "title", "summary", "thumbnail",
  "numComments": 0, "isAuthorParticipating", "upvoted",
  "highlightedTitle": [{type: "text"|"highlight", text}], "highlightedSummary": [...] }
```

`highlighted*` 占了大半体积，解析时可以丢。`submittedOnDailyAt` 只在上过 Daily Papers 的论文上有。没有 arXiv 分类（cs.RO 之类）、没有引用数、没有 PDF 链接字段（链接按 `https://arxiv.org/abs/<id>` 拼）。

排序：按相关度，不是按时间。符号回归的 120 篇里近 365 天内的有 35 篇，前 20 里只有 3 篇。

多词查询：用 2 到 4 个词的短语时表现好，"symbolic regression" 前 20 全部相关，"AlphaEvolve" 的 28 篇基本都是 AlphaEvolve 一族；它按语义匹配，不要求每个词都出现，所以词多了也不会搜空，代价是尾部混入只沾一个词的论文（"self-driving lab" 把 self-driving cars 带进来）。具体数字见附录。

窗口：只能客户端过滤。`paper.publishedAt` 与 arXiv v1 日期有出入（例：2102.10570 的 `publishedAt` 是 2021-10-26，2602.08885 是 2026-05-29），推测是最近一版或 HF 收录日，【未证实】。窗口下界要么放宽一个月，要么用 arXiv 编号的年月当 v1 月份的下界。最外层的 `publishedAt` 比 `paper.publishedAt` 早几小时（每日页的时间戳），不要用它。

## 二、每日论文和趋势

`GET /api/daily_papers`，全部【实测】，参数名【三方】也列了。

| 参数 | 实测 |
|---|---|
| 无参数 | 最新一页往后的流，按 `submittedOnDailyAt` 倒序；周日请求拿到的是周五（10-16）的页 |
| `date=2026-10-15` | 只回那一天的页，周末是 `[]`（坑 323） |
| `week=2026-W41`、`month=2026-09` | 回该周、该月，按 upvote 降序 |
| `sort=trending` | 近期热度，混有老论文（返回里有 2024 年的 AutoDev，GitHub 星 3 万） |
| `sort=publishedAt` | 与默认一样 |
| `limit` | 三方文档写 1 到 100；`limit=3`、`limit=5` 有效 |
| `p` | 页码从 0 起；`limit=5` 的响应带 `Link: <...&p=1>; rel="next"`，`p=1&limit=3` 从第 4 条接着给 |

行的形状同搜索，但多了 `submittedOnDailyAt`、`submittedBy`、`submittedOnDailyBy`。趋势页 `huggingface.co/papers/trending` 是 HTML，页面里 `DailyPapers` 组件的 `data-props` 带 `isTrending: true` 和 50 行，与 `daily_papers?sort=trending` 同序；没有独立的趋势 API。

论文页 `huggingface.co/papers/<id>` 的数据就是 `GET /api/papers/<id>`（4.5 KB 到 19 KB）：除搜索里的字段外有 `githubRepo` 加 `githubRepoAddedBy`（`auto` 或用户名）、`linkedModels`、`linkedDatasets`、`linkedSpaces` 和三个 `numTotal*`。Llama 2 的 `numTotalModels` 587、数据集 22、Space 4208，列表里各只有几个；AI Scientist v2 全是 0。评论的读取没找到 GET 接口（官方 OpenAPI 的 papers 部分只有发评论的 POST），只有 `numComments` 数。

论文到制品的关系可以反查：`api/models?filter=arxiv:<id>`、`api/datasets?filter=arxiv:<id>`、`api/spaces?filter=arxiv:<id>`（模型那条实测有效，数据集和 Space 对没有链接的论文回 `[]`，没找到有链接的样例验证）。`api/collections?item=papers/<id>` 回包含这篇论文的用户收藏集（AI Scientist v2 回 5 个，其中 "Scientific" 和 "Agentic AI for science" 两个的前 4 项里能看到这篇），列表里每个集只给前 4 项，完整内容要另取，【未证实】。`api/arxiv/<id>/repos` 回 `{"models":[],"datasets":[],"spaces":[]}`，与 `filter=arxiv:` 同类，没有额外信息。

## 三、热榜、排行榜、其他

- 模型、数据集、Space：`api/models|datasets|spaces?sort=trendingScore&limit=n`，行里有 `trendingScore`、`likes`、`downloads`、`tags`（含 `arxiv:<id>`、`base_model:` 关系）、`createdAt`。现有插件已经在用。`search=<词>` 参数也可用（`api/datasets?search=symbolic regression&sort=likes` 回 2 个相关数据集）。
- 排行榜：Open LLM Leaderboard 的 Space 点赞 14149，但它背后的数据集 `open-llm-leaderboard/contents` 最后修改是 2025-03-20，已停更。别的榜（mteb/leaderboard 7740 赞、lmarena-ai/arena-leaderboard、bigcode、open_asr）各自是独立的 Space，数据放在各自的结果数据集里，没有统一接口。对"读 AI 研究的人"价值有限，对 AI for science 这类主题没有对口的榜。
- 收藏集：`api/collections?q=<词>&limit=n` 可搜（"scientific discovery" 回 3 个，都是个人收藏集，upvote 0）。质量参差，是冷门主题找线索的补充，不是主源。
- 博客：`https://huggingface.co/blog/feed.xml` 是 RSS，约 260 KB、880 条全历史，每条只有标题、日期、链接。属于叙事源，不属于主题搜索。
- 官方 OpenAPI：`https://huggingface.co/.well-known/openapi.json`（Markdown 版 `openapi.md`）。我只读到它的前 10 万字，papers 的读取接口没在读到的部分里，所以上面的参数以实测为准。

## 四、限额、缓存、条款

限额：
- 【官方】三个桶：Hub APIs、Resolvers、Pages，5 分钟固定窗口。匿名按 IP：API 500、Resolvers 3000、Pages 100；免费账号：1000、5000、200；PRO 2500、12000、400。匿名和免费的数值"可能随平台状态变"。超限回 429，用 `RateLimit` 和 `RateLimit-Policy` 头报余量和窗口。来源 https://huggingface.co/docs/hub/rate-limits 。
- 【官方】建议"总是带 `HF_TOKEN`"，这是不被限流的头号办法；免费 token 把匿名的 API 500 抬到 1000，Pages 100 抬到 200。
- 【实测】`/api/papers/search` 的头是 `ratelimit: "search";r=49;t=221` 和 `"fixed window";"search";q=50;w=300`，即搜索自成一桶，匿名 50 次/5 分钟。免费 token 对这个桶是否抬高没验（没认证）。其余 `daily_papers`、`papers/<id>`、`models` 等是 `"api"` 桶 500；网页和 RSS 是 `"pages"` 桶 100。
- 一个主题一晚 7 到 10 个搜索请求，几个主题连发也用不到 50；请求间隔 3 秒就够，不会撞窗口。

缓存：
- 【实测】响应带 `ETag`，`If-None-Match` 命中回 304 空体（`daily_papers?limit=5` 验过）；没有 `Cache-Control` 头；`x-cache: Miss from cloudfront`，前面是 CloudFront。
- 【实测】压缩：带 `Accept-Encoding: gzip` 回 `content-encoding: gzip`，搜索响应缩到约四分之一。应用的 fetch 层要确认发了这个头。
- 浏览器端直接 fetch 不行：响应头 `access-control-allow-origin` 只放行 `https://huggingface.co`，必须走原生侧的 fetch（现有插件的 `fetchFn` 就是）。

条款：
- 【实测】`robots.txt` 是 `Allow: /`。
- 【官方】Terms of Service 主文没有写自动化访问、抓取、API 使用规则，指向 Supplemental Terms，我没读到补充条款（https://huggingface.co/terms-of-service ），【未证实】。API 文档只说"所有 API 调用受 HF 全站限额约束"（https://huggingface.co/docs/hub/api ）。
- User-Agent：没找到官方要求。沿用项目的礼貌 UA，把 `huggingface.co` 加进 `POLITE_UA_HOSTS`（`platform/http/throttled-fetch.ts`）。
- `ai_summary` 是 HF 用模型（`ai_summary_model` 字段，如 Qwen2.5-Coder-32B）生成的，再利用的条件没查到；用它当筛选输入没问题，印进简报书之前要先查。摘要 `summary` 是 arXiv 摘要原文。

## 五、与现状对照

现有的 `src/info/sources/plugins/huggingface.ts`：
- `kind: papers` 按日取 `daily_papers?date=`，一天一个请求，周末空（坑 323），`days` 最多 31；`models`、`datasets` 走 `sort` 和 `pipeline_tag`、`author`、`tags` 过滤，丢弃量化转换版。
- 条目只有标题层：`summary` 取 400 字，`signals` 有 `upvotes`、`comments`；`publishedAt` 取了最外层的日页时间戳，不是 `paper.publishedAt`。
- 没有 `search`、`lookup`、`enrich` 槽；没读 `githubRepo`、`githubStars`、`projectPage`、作者、`ai_summary`。`InfoItem.authors` 和 `ItemSignals` 里已有 `stars` 和 `tags`，够装。

梯子 `info/topic-search/arxiv-ladder.ts`：
- 一条查询最多 3 个请求，词按特异性排序、逐步丢词、最后放宽窗口；凑够 `ARXIV_ENOUGH`（3）篇就停；结果六种：`direct`、`widened`、`exhausted`、`rate_limited`、`cooling_down`、`failed`；限流的判断复用 `isRateLimitError` 和 `isHostCoolingDown`。
- 它为 arXiv AND 语义设计。HF 是语义检索，丢词和逐步放宽词的步骤没有意义；窗口放宽则不需要新请求，因为一个响应里已有 120 篇全时段的结果。

## 六、设计建议

### (a) 梯子的关键词步

新增 `hfLadder`（或让梯子按源参数化），结局沿用同样六个名字：
1. 一个请求：`papers/search?q=<最特异的 3 到 4 个词>&limit=120`，按 `paper.publishedAt` 做窗口过滤（下界放宽一个月，或用编号年月兜底）。窗口内的篇数 ≥ `ARXIV_ENOUGH` 记 `direct`。
2. 不够时不发请求：把窗口起点按 `ARXIV_WIDEN_DAYS` 往前放宽，在同一份响应上重新过滤，凑够记 `widened`，仍为空记 `exhausted`。
3. 429 记 `rate_limited`，宿主冷却中记 `cooling_down`，其他失败记 `failed`。
4. 相关度尾部过滤：程序要求标题、摘要或 `ai_keywords` 里至少含一个查询核心词（沿用 88 的"锚词"做法），丢掉自动驾驶这类只沾一个词的论文。

两种用法：
- 主：每条查询先跑 HF，再跑 arXiv 梯子补缺，按 arXiv id 合并；HF 的条目带 `githubRepo`、星数、`ai_summary`，合并时留着。
- 兜底：arXiv 梯子是 `rate_limited`、`cooling_down` 或 `failed` 时，对同一条查询跑 HF，源健康按（主题、查询、源）写一行 `huggingface`，arXiv 那行仍记 `failed`，「重跑第一次」照补 arXiv。

实现位置：`huggingface` 插件加 `search(text, opts, deps)` 槽（`SearchOptions.since/until` 本来就有），条目 `id` 用 arXiv id 作 `sourceKey`，URL 用 `https://arxiv.org/abs/<id>` 方便并入 arXiv 候选，`signals.stars` 放 `githubStars`，`signals.upvotes` 放 upvotes。

请求成本：每条查询 1 个（arXiv 梯子是最多 3 个）；一个主题 6 到 8 条查询，第一次 run 6 到 8 个，响应约 8 到 10 万字节（gzip）一个。

### (b) 每晚增量

搜索不能按日期过滤，每晚用同一条查询拿全时段前 120，新论文只有相关度够高才进得来；热门老论文会挤掉它们。所以增量分两路，都只在客户端过滤：
- 路 1：对每条子方向查询跑同一个搜索，过滤 `paper.publishedAt` 在上次 run 之后、且不在 30 天已列过的键里（88 的去重）。每晚每主题 6 到 8 个请求。
- 路 2：`daily_papers` 流，从无参数的最新页开始用 `limit=100&p=0,1,...`，翻到 `submittedOnDailyAt` 早于上次游标为止，通常 1 到 2 个请求，所有主题共用；再用主题的查询词在标题、摘要、`ai_keywords` 上做程序匹配。这一路只覆盖被提交到 Daily Papers 的论文（每天几十篇，量级【未证实】），对 AI 圈大热题有效，对冷门题价值低。
- 带条件请求：流和搜索都带 `If-None-Match`，没变化回 304，不占解析。

合计一个主题每晚约 7 到 10 个请求，三个主题约 25 个，远低于 API 桶 500 和搜索桶 50（搜索桶要靠 3 秒间隔摊开，三个主题 24 个搜索请求在 5 分钟内约 72 秒，安全）。

### (c) 读原文时的补充

对进入读深的论文（第一次 5 篇、每天 2 篇）各发一个 `GET /api/papers/<id>`：代码仓库和星数、项目页、机构、关联的模型、数据集、Space 的数量和前几个、`ai_keywords`。这些写进事实行（88 的事实行由程序写）。搜索和日流的行已经带 `githubRepo` 和星数，已有这些的论文可以省掉这个请求，只为"关联制品"才发。实现成插件的 `lookup(arxivId)`，把结果挂到 `signals.tags`（"code"、"weights"、"dataset"）和 `stars` 上；`enrich` 槽留给 day-3、day-14 重打分（upvotes 的变化）。成本每个主题每次 run 2 到 5 个请求。

## 七、弱点

- 覆盖：搜索索引宽（58% 的结果 upvote 为 0，含 2012 年的论文），但不是全 arXiv。HF 自己的 404 文案说论文要被 repo README 引用才有页面。梯子找到的 2610.11059 就缺。所以 HF 不能取代 arXiv，只能和它互补。
- 新鲜度：这次结果里最新的编号是 2610.22344；2610.11059 缺是未收录还是延迟，没法区分。延迟没量化，不要承诺"当天"。
- 相关度：长尾噪声明显（附录的 self-driving lab 和 domain prior 两条）；"autonomous experimental design" 的前 20 里 14 篇是自主科研智能体，没有一篇是实验设计（DOE、主动学习）意义上的，是语义检索把"autonomous"和"experiment"理解成 AI 做研究。
- 时间字段不可信：`paper.publishedAt` 在约 12% 的论文上与 arXiv 编号年月不一致。
- 单请求体积大：120 条 650 到 900 KB，不压缩时慢；必须发 gzip，并把 `highlighted*` 丢掉。
- 无搜索排序、无日期过滤、无翻页，一次只能取相关度前 120。
- 条款：补充条款没读到；`ai_summary` 的再利用未查。

## 八、建议和搭建顺序

建议：HF 论文搜索作为主题搜索梯子的第一步，arXiv 梯子照旧补缺；arXiv 失败时 HF 单独出结果。每晚增量以"搜索加客户端日期过滤"为主，`daily_papers` 流为辅。不做排行榜和博客的主题接入（博客另算叙事源）。

顺序：
1. `huggingface` 插件加 `search` 槽：请求、gzip、解析（丢 `highlighted*`）、窗口过滤（下界放宽一个月）、锚词过滤、`publishedAt` 改取 `paper.publishedAt`；读 `githubRepo`、星数、作者、`ai_summary`、`ai_keywords`；单测用脚本化 fetch，样例取附录里的响应形状。
2. 梯子加 HF 版（一次请求、窗口原地放宽、六种结局），`run` 的 `read` 相位里 arXiv 之前先跑；兜底路径：arXiv 非 `direct/widened` 时的 HF 补跑；源健康加 `huggingface` 一行；`POLITE_UA_HOSTS` 加 `huggingface.co`。
3. 按 arXiv id 并入现有候选（RRF 之前合并），HF 的星数和 `ai_summary` 进事实行的素材。
4. `lookup(arxivId)` 读深补充：代码、星数、关联制品。
5. 每晚路 2：`daily_papers` 流游标和主题匹配。
6. 再看：`enrich` 的 upvotes 重打分；集合搜索当冷门主题的线索。

没验到、需要后续确认的：搜索桶对免费 token 是否抬高；Daily Papers 每天的页大小；`paper.publishedAt` 的确切含义；收录延迟；补充条款对自动访问的规定；`ai_summary` 的再利用条件；`filter=arxiv:` 对数据集和 Space 有链接时的返回；集合完整内容的接口。

## 附录：七条子方向查询的实测

窗口列按"近 365 天"（以 2026-10-18 为今天）数 120 篇里的篇数；相关数是我按标题判断前 20 里相关的篇数。

| 查询 | 返回篇数 | 近 365 天 | 前 20 近 365 天 | 前 20 相关 | 前 5 标题 |
|---|---|---|---|---|---|
| symbolic regression | 120 | 35 | 3 | 20 | Deep Generative Symbolic Regression with Monte-Carlo-Tree-Search；SymbolicGPT；Transformer-based Planning for Symbolic Regression；GFN-SR；Sparse Interpretable Deep Learning with LIES Networks for Symbolic Regression |
| autonomous experimental design | 120 | 83 | 16 | 14（均为自主科研智能体，0 篇是实验设计） | From AI for Science to Agentic Science；RigorBench；Why LLMs Aren't Scientists Yet；RAGA；Autonomous and cooperative design of the monitor positions for a team of UAVs |
| scientific discovery agent | 120 | 67 | 11 | 19 | Accelerating Scientific Discovery with Autonomous Goal-evolving Agents；Eureka；BayesEvolve；EvoMaster；ThunderAgent |
| AlphaEvolve | 28 | 24 | 16 | 19 | AlphaEvolve: A coding agent for scientific and algorithmic discovery；Scientific Algorithm Discovery by Augmenting AlphaEvolve with Deep Research；Improving the matrix multiplication exponent with modern optimization and AlphaEvolve；Mathematical exploration and discovery at scale；Discovering Multiagent Learning Algorithms with LLMs |
| Bayesian optimization expensive evaluation | 120 | 24 | 3 | 20（都是贝叶斯优化，"昂贵评估"只靠语义） | Fast and Accurate Bayesian Optimization with Pre-trained Transformers for Constrained Engineering Problems；A Tutorial on Bayesian Optimization；Multi-Objective Bayesian Optimization for Model Merging；A Tutorial Review of Bayesian Optimization with Gaussian Processes to Accelerate Stationary Point Searches；Bayesian Optimization through Gaussian Cox Process Models for Spatio-temporal Data |
| self-driving lab | 48 | 13 | 5 | 5（另有 2 篇边界） | Agents for self-driving laboratories applied to quantum computing；LabRobFail；Beyond Low Earth Orbit: Biological Research, AI, and Self-Driving Labs；LabInstruct；AEGIS: Assay-Aware Protocol Validation for Open-Source Liquid Handling Robots |
| domain prior physical black box | 120 | 35 | 5 | 6（多半是黑盒对抗攻击） | How to Robustify Black-Box ML Models? A Zeroth-Order Optimization Perspective；Silent Failures in Physical AI；Simple and Efficient Hard Label Black-box Adversarial Attacks；Physics-guided Noise Neural Proxy for Low-light Raw Image Denoising；Versatile Backdoor Attack with Visible, Semantic, Sample-Specific, and Compatible Triggers |

对照：arXiv 梯子在 2026-10-16 的 run 里整个主题只找到 1 篇（2610.11059，符号回归），该篇不在 HF 符号回归查询的 120 篇里。窗口按近 365 天过滤后，7 条查询各自还有 13 到 83 篇可用。

附：请求清单（共 38 个）。论文搜索 11 个（7 条查询、`limit=10`、`skip`、`sort/since` 三个参数探针、一个 gzip 重复请求）；`daily_papers` 8 个（无参数、`date`、`sort=trending`、`week`、`month`、`p=1`、`sort=publishedAt`、一个带 `If-None-Match` 的 304 验证）；论文页和制品反查 8 个（`papers/<id>` 两个、`filter=arxiv:` 的模型两个加数据集和 Space 各一个、`arxiv/<id>/repos`、`collections?item=`）；热榜 3 个；趋势页、博客 RSS、robots、排行榜数据集各 1 个；Space 搜索、集合搜索、数据集搜索各 1 个；覆盖探针（`api/papers/2610.11059`，404）1 个。
