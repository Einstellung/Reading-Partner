# AI信息筛选调研

2026-10-13 对 AI 替人盯信息流并筛选的开源项目的调研。起因是希望将来不再自己刷 X 等信息渠道，由 AI 自己查、过滤、筛选。内容分四块：现有管线，十个左右代表项目的机制和许可证，X 取数的几条路，对 info 侧筛选管线的分层建议。

## 我们现在有什么

info 侧现在的管线分四步：发现 → 粗筛 → 取正文 → 分拣（[docs/35](../info/35-简报漏斗.md)）。粗筛（`src/info/collect/screen.ts`）一批 50 条，只看标题、来源、摘要和 signals，回答这条命中了哪个研究室的哪条可观测项（[docs/63](../info/63-情报局：研究室、专项组与态势.md)）。用户画像不进粗筛。

去重只靠条目 id 和池子里的标记（marks）。没有近重复识别，没有事件聚类，全仓没有任何嵌入（embedding）能力。

反馈信号来自 cable 的状态（dismissed / told / asked / saved / promoted），[docs/63](../info/63-情报局：研究室、专项组与态势.md) 设计成按源、按研究室、按产物版本聚合，只调源权重和预算。画像已换成 statement（profile/concern）加观察（[docs/48](../soul/48-记忆：观察与statement.md)），guess/declared 两段已删。"转载不加分""源可靠性 A–F""引子帖只当引子"（[docs/84](../info/84-X链接摄入.md)）都已写进设计。

## 代表项目

**1. karpathy/arxiv-sanity-lite**（MIT，1.7k 星，最后提交 2023-06）
- 机制：摘要做 TF-IDF（1–2 元组，2 万特征，sublinear_tf）。每次排序现训一个 `LinearSVC(C=0.01, class_weight='balanced')`：用户打过标签的论文当正例，库里其余全部当负例，按 `decision_function` 排序。同时把权重最高的 40 个词和最低的 20 个词展示给用户，当作解释。
- 取数：arXiv API。成本：零模型调用。
- 可借：不需要嵌入，几十个正例就能训出个人分类器，而且能用词解释为什么推荐。纯 TS 能重写。

**2. Scholar Inbox**（平台闭源，论文 arXiv 2504.08385，评分数据集公开）
- 机制：标题加摘要用 GTE-Large 编码，PCA 降到 256 维，每个用户一个逻辑回归。负例有两种：用户明确点踩的，加约 5000 篇随机未交互论文，后者降权。参数 C=0.1、V=0.8（显式负例和随机负例的配比）、S=5。
- 主动学习：优先给用户看决策边界附近的条目，每次评分后重训。冷启动靠导入自己或相关作者的论文。用户平均约 78 个正例。论文承认信息茧房没解决。
- 可借：带权负例和主动学习的取样方法。

**3. TideDra/zotero-arxiv-daily**（AGPL-3.0，6.0k 星，2026-10 仍活跃）
- 机制：候选论文与用户 Zotero 库里每篇论文算余弦相似度，按入库时间倒序加权。权重是 `1/(1+log10(rank+1))` 归一化，打分是加权和乘 10。
- 嵌入可以本地 sentence-transformers，也可以走 OpenAI 兼容的 embeddings 接口。LLM 只给排在前 N 篇的写一句话 TLDR、抽作者单位，不参与排序。
- 许可证是 AGPL，只借思路：用户的书库就是兴趣画像，越新的书权重越高。

**4. finaldie/auto-news**（MIT，910 星，最后提交 2025-07）
- 取数：tweepy 走 X 官方 API 读 Lists，另有 RSS、Reddit、YouTube。
- 去重：按条目 id 查 Redis/Notion。
- 兴趣分：在 Milvus 里找用户评过分的历史条目的最近邻（topk=2，距离 ≤0.45），兴趣分就是这些邻居用户评分的平均值。找不到邻居记 −1，算冷启动，直接放行。
- 过滤：每个 X List 单独设阈值（`TWITTER_FILTER_MIN_SCORES`，默认 3.5）。
- LLM 打分：最后让 LLM 出 topics、category 和 0–1 的 overall_score，但它的提示词考的是语法和连贯性，对筛选几乎没用。
- 反馈回路：用户在 Notion 里打分，分数写回向量库。
- 可借：用过去评过分的条目做最近邻来算兴趣分、按源分阈值、冷启动时放行。不可借：Milvus、Redis、Notion 这套常驻服务。

**5. samuelclay/NewsBlur**（MIT，7.7k 星，持续活跃）
- 规则分类器：按 feed、作者、tag、标题短语、正文、URL 分别打 ±1（付费档加正则）。合并规则在 `compute_story_score`：任一项 ≤−2 时直接取它（强否决压过所有正分），否则有正取最大正分，再否则取最小负分，全为 0 才看 feed 级。
- 新加的提示词分类器：用户按 feed 或文件夹写一句自然语言的 focus 或 hidden 规则，LLM 对每条回 1/0/−1。focus 规则只采信 +1，hidden 规则只采信 −1。
- 缓存：结果按（规则, 条目）缓存，TTL 跟随该 feed 的未读保留期。调用失败不写缓存，免得一次故障把整批条目记成"不匹配"。
- 可借：合并规则、按（提示词版本, 条目）缓存、失败不缓存。

**6. ginobefun/BestBlogs**（无许可证，4.1k 星）
- 两段式：初评只看元信息（标题、源、分类、语言、发布时间、≤200 字摘要），用便宜模型（v1 DSL 里是 gemini-2.0-flash）。输出 `ignore`、`reason`、`value`（现在是 0–100）、`summary`，`value ≥ 30` 才进全文分析。
- 提示词用 CO-STAR 框架，带 8 个示例，其中负例包括过度营销、只有时间地点的发布通知、电子产品促销、非目标语言。
- X 内容走第三方 RSS 服务 XGo.ing。
- 没有许可证，只借思路。可借：用负例示例写清"水文"长什么样。

**7. zarazhangrui/follow-builders**（无许可证，6.9k 星，2026-10 活跃）
- 机制：不打分。筛选完全靠中心维护的 26 个 builder 账号名单加 6 个播客。
- 取数：X 官方 API v2 bearer（付费），播客转写走 pod2txt。
- 摘要提示词写死了跳过规则：无评论转推、推广、"great event"、刷互动的帖；线程合成一篇；引用推文要带上被引内容；没有实质内容就写 "No notable posts"，不凑。
- 结论：对 X 这类源，账号白名单是最强的一层过滤。

**8. YanCheng-go/my-focal-ai**（CC BY-NC，13 星，小项目，只看它的提示词）
- 三原则依次判：信号重于噪音、机制重于观点、做事的人重于评论者。另外输出一个枚举 `source_proximity`：origin / implementation / derivative / noise（原创 / 实现 / 转述 / 噪音）。
- X 取数：用 rookiepy 读本机 Chrome 的 `auth_token` 和 `ct0` cookie，直接调 X 的 GraphQL。
- 只借思路：把"离原始出处多远"做成枚举输出。

**9. xai-org/x-algorithm**（Apache-2.0，33.6k 星，2026-10 活跃）
- 打分前的过滤：跨源去重、超过 48 小时丢弃、已看/已推过的丢弃、静音词，最后把同一会话的分支折叠成一条（`DedupConversationFilter`）。
- 负反馈权重极重：`not_interested −47.52`、`mute −58.8`、`block −31.2`、`report −234`，对比 `favorite 0.5`、`reply 5.0`。
- 同作者衰减：乘数为 `(1−floor)·decay^k + floor`，k 是排在它前面的同作者条数（测试里 decay 0.5、floor 0.25）。
- 多样性：最后用嵌入做 DPP 重排。
- 账号可信度（`user-cred-v2`）：在关注图上传播"质量"（mass），分数 = `165.2 + 7.07·ln(mass)`，夹在 0–100。
- 许可证是 Apache-2.0，公式可以直接搬。

**10. kagisearch/kite-public**（代码 MIT，数据 CC BY-NC）
- 聚类后端没开源。公开的是两样东西：
  - `media_data.json`：528 家媒体的国家、所有者和简介。
  - `contentFilters.json`：按类别分的多语言屏蔽词表。
- 文档说的做法：同一时间窗里报道同一事件的文章聚成一个 story，记录有多少个不同域名参与，作为覆盖面信号；一天只更新一次。
- 相关论文 Vasilyev & Bohannon（arXiv 2402.10302）：嵌入聚类后，簇的简单属性就和 LLM 判的重要紧急度强相关。具体是哪个属性，摘要页没给。

**补充三个短参考**
- Feedly Leo（闭源，帮助文档写明）：正文重合 >85% 判重，只在 31 天窗口内比，200 字以下不判，同一个源内部不判。静音词带有效期（1 天 / 1 周 / 1 月 / 永久）。"Less like this" 要选原因，例如 Not About。
- social-protocols/quality-news（Apache-2.0）：`upvoteRate = 实得赞 / 按曝光位置预期的赞`，把排名带来的马太效应扣掉。要分钟级抓 HN，得常驻服务器，只借"热度按曝光归一"的想法。
- 另两个只看了摘要、没读源码的 HN 推荐器：CHN（用户点赞和收藏训分类器）、Julien 的 HN 推荐（嵌入）。

## X 取数的路子

| 路子 | 成本 | 风险 |
|---|---|---|
| 官方 API 按量付费 | 第三方指南称读一条约 $0.005；免费档 2026-02 起停止新注册。100 个账号、每天 5 条，约 1.5 万条/月 ≈ $75 | 合规 |
| 第三方 API（twitterapi.io 等） | 约 $0.15/千条（自报，没核实） | 违反条款，数据来自它们自己的账号池 |
| twscrape / twikit（MIT） | 免费 | 用 cookie 组账号池调 GraphQL，多账号本身违反 X 条款，有封号风险 |
| RSSHub X 路由（AGPL） | 免费 | 要 `auth_token`，封号风险同上 |
| Nitter（AGPL） | 免费 | 要真实账号的 session token；2026-08 收到 X 的律师函，仓库现在是 archived 状态 |
| 登录态 Chrome 读 DOM（已定方向） | 免费 | 自己账号、低频、只读时风险最低 |

X 侧建议：在 PC 上每天读 2–4 次用户自己建的 X List，只读，不跑搜索；最好用副号读，主号不碰。List 本身就是账号白名单（follow-builders 的经验）。少数关键账号要保证时效的，再考虑官方 API 按量付费。

## 对 info 侧的建议

### 筛选管线分层

越往后越贵。模型只回编号和枚举值，事实都由程序算。

- **L0 规则（程序，零成本，iOS 和 PC 都能跑）**
  - URL 规范化：去掉 utm 等追踪参数，展开 t.co 短链。
  - 条目已有的 id 和 marks 去重保留。
  - 静音词带有效期（Feedly 的做法）。
  - 作者和源的允许/屏蔽名单，合并用 NewsBlur 的强否决规则。
  - 年龄和语言门槛。
  - 无评论转推直接丢；同一线程折叠成一条。
  - 引子帖由程序判：有外链、正文去掉链接后很短的帖，产物换成它指向的那个链接，沿用 [docs/84](../info/84-X链接摄入.md) 的规则。
- **L1 近重复和事件聚类（程序）**
  - 先用 MinHash（字符 shingle 的 Jaccard）合并转载，纯 TS 就能写，不需要嵌入。
  - 每个簇由程序数"独立原始报道方"的个数。这既是 [docs/63](../info/63-情报局：研究室、专项组与态势.md) 的"本条可信度"，也直接当重要度信号（Kagi 的做法、2402.10302 的结论）。
  - 嵌入等 L2 真需要时再引入：Anthropic 没有 embeddings 接口，要走 OpenAI 兼容服务；或者统一由 PC 采集端算，保证各设备向量一致。
- **L2 学到的兴趣分（程序）**
  - 每个研究室训一个 TF-IDF 加逻辑回归。没有嵌入也能跑，还能用正负权重最高的词作解释（arxiv-sanity 的做法）。
  - 标签：saved / promoted / asked 记正例，dismissed 记负例，told 记 0（[docs/63](../info/63-情报局：研究室、专项组与态势.md) 已定），再加降权的随机负例（Scholar Inbox 的 V 参数）。
  - 正例攒够之前，退化成在评过分的历史条目里找最近邻（auto-news 的做法），冷启动一律放行。
  - 这个分只在研究室内部排序和截断时用，不改可观测项，和 [docs/63](../info/63-情报局：研究室、专项组与态势.md) 定的"刹车"一致。
- **L3 LLM 粗筛（现有）**
  - 保持逐条绝对判断加可观测项命中。
  - 提示词补 BestBlogs 那类负例：营销、只有时间地点的发布通知、促销。
  - 多输出一个枚举 `source_proximity`（原创 / 实现 / 转述 / 噪音）。
  - 结果按（提示词版本, 条目）缓存，失败不缓存（NewsBlur 的做法）。
- **L4 取正文和分拣（现有）。**
- **L5 进盒子前排序**
  - 同作者、同源用 X 的衰减乘数。
  - 簇间做 MMR 去冗余。
  - 新颖度 = 1 − 与 30 天内已呈现过条目的最大相似度。
  - 每天一条 `outside` 名额（已有）保留给探索，用来对抗信息茧房。

### 兴趣画像从哪来

- 显式的一层：研究室的章程和可观测项（现有）。
- 隐式的一层：L2 用 cable 状态训出来的分类器。
- statement 里的 concern 只用来算 [docs/69](../info/69-源模型：索引、叙事源、用户带来的与快照.md) 说的"离用户 concern 多远"，不回灌进粗筛，维持 [docs/63](../info/63-情报局：研究室、专项组与态势.md) 去掉 profile 输入的决定。
- 冷启动用用户书库里的书和高亮做正例，学 zotero-arxiv-daily：越新的权重越高。

### 质量信号

- 源可靠性 A–F（已定）按命中率和交互率更新。
- X 账号可信度做个人版的 TweepCred：在用户信任的种子账号里，有几个关注、转发或引用过它。
- star、点赞按曝光或基线归一，看增速，不看绝对数（Quality News 的思路），配合 [docs/69](../info/69-源模型：索引、叙事源、用户带来的与快照.md) 已有的刷 star 核验。

### 许可证和适用性

- **可以搬代码或公式**：x-algorithm 的作者衰减公式和负反馈权重的做法（Apache）、NewsBlur 的合并规则和缓存语义（MIT）、arxiv-sanity 的分类器做法（MIT）、auto-news 的最近邻评分（MIT）、Quality News 的曝光归一（Apache）。
- **只借思路**：zotero-arxiv-daily、RSSHub、Nitter（AGPL），BestBlogs、follow-builders（无许可证），my-focal-ai（CC BY-NC），Feedly（闭源）。Kagi 的 `media_data.json` 许可证归属不清，按只借思路处理。
- **不适合我们**：Milvus / Redis / Notion 常驻栈；Quality News 的分钟级抓取；X 的 Phoenix 大模型（要海量数据）；twscrape 多账号池和第三方 X API（违反条款）；大规模官方 X API（成本）；Nitter（已 archived，有法律纠纷）。

## 没查完的

- Kagi 的聚类实现（闭源）。
- 2402.10302 具体用的是哪个簇属性。
- daily-arXiv-ai-enhanced、CHN、Julien 的 HN 推荐器、Reddit 专项，都没读源码。
- 用 Grok 的 X 搜索作取数渠道，没核实。
- X 官方价格和 twitterapi.io 价格都来自第三方页面，没看到官方定价页。

Sources:
- [Scholar Inbox 论文](https://arxiv.org/html/2504.08385)
- [How to Discern Important Urgent News?](https://arxiv.org/abs/2402.10302v1)
- [Feedly 去重说明](https://docs.feedly.com/article/218-how-does-deduplication-work)
- [X API 按量付费说明（第三方）](https://opentweet.io/how-to/x-api-pay-per-use-explained)
- [X API 2026 价格（第三方）](https://bundle.social/blog/x-api-pricing-2026-costs-limits)
- [twitterapi.io 价格对比（第三方）](https://www.getxapi.com/blogs/cheapest-twitter-api-2026-8-providers-ranked-by-real-per-1000-tweet-cost)
- [Nitter 现状](https://groundy.com/articles/running-your-own-nitter-instance-what-the-post-takedown-comeback-requires/)
- [Nitter Wikipedia](https://en.wikipedia.org/wiki/Nitter)
- [Quality News](https://github.com/social-protocols/quality-news)
- [Kagi News 模型说明（镜像）](https://mintlify.wiki/kagisearch/kite-public/concepts/news-model)
- [HN 推荐相关搜索结果（CHN 等）](https://gitee.com/mirrors/CHN)
- [MyFocalAI](https://tomevault.io/tome/YanCheng-go/my-focal-ai)
- [follow-builders](https://www.sourcepulse.org/projects/26649721)