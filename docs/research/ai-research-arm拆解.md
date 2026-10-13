# ARA（guzus/ai-research-arm）源码拆解

2026-10-13。用户希望 agent 按话题替他去各平台搜新闻和舆情，以英文世界媒体为主、要支持好，中文只做小红书、抖音、微博。[舆情监测agent调研](./舆情监测agent调研.md)之后，对最接近需求的项目逐个拆源码，这份是 guzus/ai-research-arm（ARA）：固定盯 AI 领域、号称无人值守跑了九个月。

## 0. 基本事实

- **提交数**：有完整历史，2026-01-14 到 2026-10-13 共 11,056 个提交。
- **workflow 数**：`.github/workflows/` 下 35 个。
- **去重判官的模型**：`twitter-judge` lane，用 `--model opus`，映射到 `claude-opus-5-5`。它自己的 `docs/headline-dedupe.md` 写明「NOT Haiku，which this doc claimed until 2026-08-01」。
- **日报不读昨天的日报**：00:00 的全源日报 `daily-digest.yml` 不读昨天的日报。读昨天的是两条 lane：Twitter 分析员读 `research/twitter/<昨天>.md` 和今天已写的段落；`ai-news-research` 读昨天的 `ai-news.md`。
- **账号自扩已停**：explorer 只在 06-20 到 06-30 之间合进过 4 个 bot PR，之后名单的大改动是人手做的（08-07 一次加了 31 个）。

## 1. 35 个 workflow 全景

**采集和逐源编辑（定时）**

| workflow | 频率 | 读 | 写 / 模型 |
|---|---|---|---|
| hourly-twitter | `7 */3`，每天 8 次 | Birdy 按 `data/sources/twitter_accounts.json` 批量抓：119 个账号每个 20 条，7 个搜索词，news 40 条 | Opus 分析员（最多 120 轮，birdy 追查 ≤20 次，curl ≤4 次）往 `research/twitter/<date>.md` 追加 `## HH:00 UTC` 段，另写 `status/*.json` 和 headlines.json。之后去重、判官、推 Telegram，并自动派长文（24 小时内最多 2 篇，间隔至少 10 小时） |
| hourly-rss | 每 2h | 12 个官方或媒体 feed | Cursor Grok 4.6 → `research/rss/` |
| 4h-community | 每 4h | HN Algolia `front_page` 50 条；r/MachineLearning、r/LocalLLaMA、r/artificial 的 `hot.rss` | Cursor → `research/community/` |
| 2h-bluesky | 名字叫 2h，实际每天一次 | 17 个 handle 走 `public.api.bsky.app` 的 getAuthorFeed | Cursor → `research/bluesky/` |
| daily-arxiv | 每天 | export API，cs.AI/LG/CL/CV/NE 五个分类 | Cursor → `research/arxiv/` |
| daily-ai-blogs | 每 6h | 50 个博客 feed（`ai_blogs.json`） | 纯程序打分 → `research/blogs/` |
| daily-youtube | 每天 | 10 个查询，走作者自建的 tuber-api.guzus.xyz | 纯程序 → `research/youtube/` |
| ai-news-research | 每天 08:23、20:23 | Exa/Perplexity MCP，外加昨天和今天的 ai-news | Claude → `research/<date>-ai-news.md` |
| blog-subscriptions | 每 2h | Naver 韩文博客 | 纯程序 → Telegram |
| daily-earnings、market-quotes、gpu-spot、model-pricing、arm-timeline | 工作日 / 3h / 6h / 6h / 2h | 数值源 | 纯程序 |

**综合**

| workflow | 触发 | 读 | 写 |
|---|---|---|---|
| daily-digest | 00:00 UTC | 当天各 lane 的文件，Exa/Perplexity 补缺 | `research/digest/<date>-digest.md`、Telegram 摘要、播客稿、Gemini TTS 音频。失败时走确定性兜底 |
| 24h-model-timeline | 每天 06:29 | 自己用 birdy 抓公司账号、高管和搜索；程序先把 ticket 清单编好 | 对 `research/models/tickets/*.md` 增删改，外加当日 diff |
| wiki-ingest | digest 成功后 | 当日 digest 加当天更新过的 tickets | 对 `research/wiki/` 增删改 |
| daily-front-page | digest 后 | digest | 确定性 SVG 转 PNG，不用模型 |
| generative-research（4228 行） | issue、手动、Twitter 自动派 | 主题，加 `prior_context.py` 找出的旧文 | `research/generative/` 长文 |
| research-issue、translate-generative-research | issue / 长文发布后自动派，可手动补 | | 技术调研报告、韩文翻译 |

**元（运维和改进）**

- twitter-account-explorer：每周二，Sonnet。
- daily-improve：名字叫 daily，实际每周一。
- liveness-check：每 6h。
- production-synthetic：每 2h 探测线上页面。
- auto-rerun-on-runner-loss：由 workflow_run 触发。
- 另有 ci、claude-code-review（PR 触发）、claude.yml（@claude 触发）、四个 canary（手动）、twitter-model-ab（手动）、cleanup-fallback-publications（手动）。

**数据流**
```
X(birdy) ─┐  RSS ─┐  HN/Reddit ─┐  Bluesky ─┐  arXiv ─┐  blogs/YouTube(程序) ─┐
          ▼       ▼             ▼           ▼         ▼                       ▼
   research/<lane>/<date>.md   （每条 lane 由模型或程序写成当日 markdown，进 git）
          │                                    │
  Twitter headlines.json ─► 去重台账 ─► Opus 判官 ─► Telegram
          │
          ▼ 00:00
   daily-digest（加 Exa/Perplexity）─► digest.md ─┬─► front-page PNG
          │（失败时走确定性兜底）                   └─► wiki-ingest ─► research/wiki/
   24h-model-timeline（自抓 X）─► tickets/*.md ─────────┘
   周级：explorer 改账号名单开 PR；daily-improve 开改进 PR      每 6h：liveness 发告警
```

## 2. 状态

**git 里存了什么**

`research/` 下共 7,908 个文件：
- 各 lane 的当日文件。这是模型写的汇总，不是原料；原始快照只放在 `/tmp`，不提交。
- `research/summaries/`，3,178 个文件，包括 Telegram 文本、headlines、去重台账。
- `research/models/tickets/`，368 张 ticket，6.7MB。
- `research/wiki/`：106 个实体页、10 个概念页、7 个主题页，加 `index.md`、`index.json`、`log.md`。
- `research/generative/`，632 个文件。

源注册表在 `data/sources/*.json`，后端路由在 `data/agent-backends.json`，SLO 在 `data/artifact-slos.json`。

**只增删改、不重写的三类**

- **模型 ticket**：YAML frontmatter 有 5 个状态（`rumored → in-testing → confirmed → released → closed`），`verification` 取 confirmed / partial / unverified，`history[]` 只能追加，slug 永不改，从不删除。自动关单规则：
  - released 满 4 周，`released-and-aged`；
  - unverified 超过 15 轮，`stale-rumor-unverified`；
  - 被新证据推翻，`superseded-by:<slug>`。

  校验器只查 schema、日期递增和 history 有序，不和 git HEAD 比对。所以「不改旧 history」只靠提示词约束。
- **wiki**：按 slug 和 aliases 匹配，匹配上就更新，否则新建；`log.md` 只追加，从不删页。实测页面无限长大：`anthropic.md` 已有 160KB、95 个提交。最近几天的 log 里都有「Skipped for budget: …」，说明单次读不完了。
- **去重台账** `twitter-announced-history.json`：滚动保留 3,000 条。

**「状态逐日累积」具体指**：上面三类，加上两条 lane 在提示词里读前一天文件：
```
PRIOR CONTEXT (read these BEFORE writing — multi-day arcs are first-class):
- Today's file so far: {{output_dir}}/{{date}}.md
  (may already contain earlier cycles from today. If a section for
  `## {{hour}}:00 UTC` already exists because this is a rerun, replace that
  same-hour section ...)
- Yesterday's full digest: {{output_dir}}/{{yesterday}}.md
...
1. Read PRIOR CONTEXT first. Note continuing narratives. A continuing
   thread should not be re-reported from scratch; identify what changed.
```
（`prompts/twitter-analyst.md`）

日报不读昨天。日报的连续性落在 ticket 和 wiki 上。

## 3. 源清单自扩

流程分三步：
1. `scripts/explore_twitter_accounts.py`（327 行）用 4 个宽查询（`min_faves:40 -filter:replies lang:en`，每个 50 条）召回候选；
2. Sonnet 读候选、现有名单和近期 Twitter 输出，最多再查 10 次 birdy；
3. 有改动就用 `curate_twitter_accounts.py propose/apply` 生成改动，自己开 PR，等人合并。

背书的算法：
```python
engagement_bonus = min(2.0, math.log10(max(engagement, 1)) / 2.0)
topicality = float(min(3, len(bucket["ai_terms"])))
trusted = [h for h in cited_by if h.lower() in monitored_handles]
unverified = [h for h in cited_by if h.lower() not in monitored_handles]
if bucket["source"] == "mention_graph":
    if not trusted:          # 必须至少一个已在盯的账号 @ 过它
        continue
    mention_score = (3.0 * len(trusted)) + min(1.0, 0.5 * len(unverified))
    score = mention_score + topicality + engagement_bonus
else:
    score = bucket["tweet_count"] + topicality + engagement_bonus
```

**证据门槛**：
- 脚本默认 `--min-score 4`，propose 阶段用 `--min-score 3`；
- 每次最多加 5 个、删 2 个；
- 删除要「clear observed evidence」，提示词原话是 Removal is riskier than addition；
- 新账号一律进 `others` 类，其他类别只能人手加。

**PR 内容**：改 `twitter_accounts.json`，另写 `docs/archive/<date>-twitter-account-explorer.md`。PR 正文要求「Added accounts with evidence URLs and why… Removed accounts with evidence… Validation commands run」。实际样例：

> `@rohanpaul_ai` score 8.0: cited 9 times across research/twitter/2026-06-16..30 … yet not in the manifest. bird user-tweets confirms active…

可见 agent 还会用「自己的产出里引用了多少次」当信号，脚本里没有这一条。

## 4. 去重三段

程序部分在 `scripts/dedupe_headline_alerts.py`（457 行）：
```python
# Pass 1 — exact / same-source
for record, record_keys in zip(history, history_keys):
    if keys.story_key and keys.story_key == record_keys.story_key: return "duplicate_story_key"
    if keys.headline_key == record_keys.headline_key:              return "duplicate_headline"
    if keys.url_key and keys.url_key == record_keys.url_key:
        if headline_similarity(headline, record_headline) >= 0.62:  # max(containment, jaccard)
            return "duplicate_source_similar_headline"
# Pass 1d — 同一 status id / 规范化 URL 之前发过（delivered_at < now，严格小于）
#           → "duplicate_rebroadcast"
# Pass 2 — 不同 URL，14 天窗口，共享 token ≥4，且 Jaccard ≥0.5
            overlap = len(keys.tokens & record_keys.tokens)
            if overlap < CROSS_SOURCE_MIN_OVERLAP: continue
            union = len(keys.tokens | record_keys.tokens)
            if union and overlap / union >= CROSS_SOURCE_JACCARD_THRESHOLD:
                return "duplicate_cross_source_similar_headline"
```
Pass 2 只用 Jaccard，不用 containment。原因是后续报道会在原标题上追加事实，containment 会给 1.0，把它误压掉。阈值 0.5 是拿真实台账校准的：台账里 Jaccard 最高也就 0.65 左右。

争议带由 `scripts/headline_judge.py`（294 行）处理：程序挑出 Jaccard 在 [0.35, 0.5)、共享 token ≥3 的标题，每条附最近的 5 条已发标题，交给判官。判官提示词原文（节选）：
```
CARDINAL RULE: when in doubt, KEEP it (verdict "distinct").
Suppressing a real, new headline is far worse than letting one
duplicate through. Mark "duplicate" with "high" confidence ONLY
when you are certain it is the same specific event already sent.
...
DISTINCT (keep — send it) — if NONE of the candidates is the same event.
  - SAME metric/number, DIFFERENT subject -> distinct.
  - SAME templated action, DIFFERENT entity -> distinct.
  - APPENDED FACTS / real progression ... -> distinct.
  - A different, itself-newsworthy stage of an ongoing story
...
{ "url": "<the entry's url>", "verdict": "duplicate" | "distinct",
  "confidence": "high" | "medium" | "low", "matched_url": "...", "reason": "..." }
Key each verdict by the entry's "url" exactly.
```
应用判决：
```python
verdict = verdicts.get(url) or {}
is_dup = str(verdict.get("verdict") or "").strip().lower() == "duplicate"
confident = str(verdict.get("confidence") or "").strip().lower() == "high"
if is_dup and confident: suppressed.append(...); continue
kept.append(item)
```
- 判官缺席或判决文件坏了，就写一个空的 `[]`，一律照发。
- 每次压掉都推一条 Telegram 留痕，用来代替影子期。
- 争议带大约占 6% 的标题，每轮 0 到 1 条，候选为空时跳过模型。

有两点要注意：
- `normalize_headline` 把非 `[A-Z0-9.$]` 的字符全部去掉，中文标题会变成空 token，搬过来必须换分词。
- 判决按 URL 对号，但 URL 本身是分析员模型写进 headlines.json 的，我没找到程序拿它去和抓取快照核对。

## 5. 每周自审

`daily-improve.yml` 每周一跑：
- 读前一天各 lane 的输出和 workflow 文件；
- 必须指出具体缺陷，附文件路径和坏内容，否则打印 `no improvements` 退出；
- 有缺陷就开分支，改 workflow，写 `docs/archive/<date>-improvements.md`，用 `gh pr create` 开 PR；
- PR 由作者人工合并（另有 claude-code-review.yml 在 PR 上跑 Claude 审查）。

效果有它自己的注释为证：「the self-improvement loop was a noise generator (≈1/32 PRs merged)」，06-10 因此从每天改成每周。真正让系统变稳的是作者本人的 772 个提交，每月 150 到 200 个，集中在 5 到 7 月。

## 6. 各源取数和我们的走法

| 源 | ARA 怎么取 | 频率 | 我们 |
|---|---|---|---|
| X | Birdy，cookie 直调，多账号轮换，119 个账号 + 7 个搜索 + news | 3h，约 1000 次/天 | 桌面 webview。把要盯的账号建成一个 X List，登录态低频滚读 List 时间线（一页覆盖全部账号，不逐个开主页），只读 DOM；搜索少用。Birdy 这条在禁区内 |
| HN | Algolia `front_page` 50 条 | 4h | iOS 直连 |
| Reddit | `/r/x/hot.rss` | 4h | iOS 直连（公开 RSS，低频），被限流再改走桌面 |
| Bluesky | 公开 AppView 的 getAuthorFeed | 每天 | iOS 直连，无需登录 |
| arXiv | export API | 每天 | iOS 直连（已有插件） |
| 官方 RSS、专家博客 | 12 + 50 个 feed | 2h / 6h | iOS 直连（已有 feed 类源） |
| YouTube | 作者自建的 tuber-api | 每天 | 频道 RSS 走 iOS 直连；字幕走桌面 yt-dlp（已定）；tuber 不可用 |
| Exa / Perplexity | MCP 补缺 | 每天 2 次加日报 1 次 | 不做（tasking 已定不引供应商，补缺靠滚雪球） |
| GDELT、Polymarket 等 | `research_search.py` 和 gamma API，免费 | 按需 | iOS 直连，可作 tasking 工具 |

## 7. 九个月无人值守靠什么撑

- **失败处理**：
  - agent 步骤设 `continue-on-error`。
  - `require-output` 检查约定的产物路径有没有提交，`require-diff-scope` 检查改动没越界。
  - 只有日报有确定性兜底：逐字摘抄各 lane 的条目，加横幅，推 Telegram 告警。
  - 其余编辑 lane 一律 fail-closed，等下一个时段。
  - Twitter 失败会修复一次，再失败就恢复基线并报错。
  - 每轮必写 status JSON，没有新内容时只写 `no_update`，不发「本轮无事」的公开文字。
- **重试**：
  - runner 中途消失时自动重跑：只认「worker 消失」这种特征，最多重跑 2 次，watchdog 本身跑在 GitHub 托管机上。
  - birdy 被限流的操作换一个没在冷却的账号重试一次。
  - Claude「死启动」（is_error、≤1 轮、花费 $0）时，排除 claude 重选后端；已经干了活的失败不换后端重试。
- **并发写 git**：
  - 每个 workflow 一个 concurrency group，各 lane 写各自的目录。
  - `safe-push`（559 行）的做法是 stash、rebase、push，失败就重试，`index.json` 冲突时做并集合并。
  - 07-06 起 main 只收 PR：每次运行开自己的分支，开 PR，立即 squash 合并。
  - 同一文件冲突时 PR 留着，liveness 一小时后告警，人工处理。
- **预算**：没有美元上限。约束来自：
  - 各步轮数上限 4 到 120；
  - birdy 20 次、curl 4 次的工具上限；
  - job 超时 30 到 60 分钟；
  - 长文节流（24 小时 ≤2 篇）；
  - 判官只在有候选时跑；
  - 各订阅计划自己的额度（OpenCode Go 已经用穷）。
- **模型后端配置** `agent-backends.json`：
  - 分三层：lane 指向 route，route 指向 backend。
  - 全局回退链是 `claude → zai-glm-5p3`，CI 强制回退链至少跨两家供应商。
  - 编辑类 lane 现在全部跑在 Cursor Grok 4.6 上，失败就关，不跨适配器回退。
  - 探活只看鉴权：401/403 算挂，429 算活（健康的 OAuth token 每次都回 429）。
  - `docs/backend-matrix.md` 由配置生成，CI 校验两者一致。
- **健康检查**：liveness 每 6 小时跑四项：
  - 内容空壳：低于每条 lane 的绝对下限，或低于近期中位数的一定比例；
  - 线上部署延迟；
  - 按 `artifact-slos.json` 检查新鲜度（例如 rss 8 小时、twitter 9 小时、日更类 30 小时）；
  - 死人开关心跳。

  告警走 hooker 和直连 Telegram 两条通道。另有 production-synthetic 每 2 小时探测线上页面，加四个 canary。
- **代码里记下的事故**：
  - 07-24 OAuth 过期，所有 lane 同时停摆；
  - 08-30 到 09-06 把 429 误判为挂，整个系统静默跑在 Cursor 上一周，期间 timeline 连发 6 天「No change」；
  - 7 月初 Fireworks 账号被封；
  - 07-06 出现重复 Authorization 头，push 全挂；
  - birdy 1.2.0 之前每轮静默丢 7 到 42 个抓取操作，job 照样是绿的；
  - 07-09 兜底路径把 50 天前的旧推文当成新闻发了出去。
- **九个月有没有证据**：时间跨度属实，01-14 到 10-13。日报 273 天里有 207 天，缺：
  - 02-20 到 03-03；
  - 03-22 到 04-17（近一个月）；
  - 5 到 7 月零散十几天。

  07-25 之后日报不再缺天；Twitter 还缺 08-08/09 和 08-30 到 09-01。结论：数据面基本无人值守，系统本身一直在被作者高强度维护。

## 8. 成本

仓库里没有总花费数字。能找到的：
- OpenCode Go 每月 10 美元，额度是 5 小时 12 美元、每周 30 美元、每月 60 美元，已用穷；
- Claude 走订阅 OAuth（文中称「Max token」，具体档位不详）；
- 其余：Z.ai Coding Plan、Cursor 订阅、Fireworks 按量计费（已被封）、Exa/Perplexity API、Gemini TTS、自托管 runner gunux 加 Railway。

调用量推算：
- 定时 agent 运行每天约 33 次：Twitter 8、RSS 12、community 6、ai-news 2，bluesky、arxiv、digest（≤3 步）、timeline、wiki 各 1。
- 另有判官每天 0 到 8 次，长文 ≤2 篇，每周 2 次 Sonnet/Opus 运行。
- 其中 Opus 级的是 Twitter 8 次（每次最多 120 轮）、日报、timeline、ai-news。
- X 请求每天约 1,000 次以上，另有 timeline 和 explorer 自己的抓取。

## 9. 长文流程 generative-research

`generative-research.yml` 4,228 行。其中 Claude 后端的提示词约 1,100 行（685–1796 行），Fireworks 后端是同一份的拷贝（2171–3279 行），其余是后端解析、预检、重试、发布门、推送和通知。默认后端是 `claude-opus-5-5`（`agent-backends.json` 的 `generative-research-default`），10 月的 6 篇都是它写的。`research/generative/index.json` 共 132 篇，按月：5 月 40、6 月 18、7 月 24、8 月 32、9 月 12、10 月至今 6。

### 触发

- **issue**：带 `gen-research` 标签（开 issue 时就带，或之后打上），且作者是 OWNER、MEMBER 或 COLLABORATOR。标题当 topic；正文去掉 `backend:` 那行后还有内容，就当 brief。标题或正文里有 `x.com/.../status/...` 链接，就进推文种子模式。
- **手动 workflow_dispatch**：参数是 topic、twitter_url（可以只给链接）、slug、backend、tags。
- **推文种子模式**：程序拼进 prompt 的原话是
  ```
  Start by reading this tweet and its thread/conversation with the authenticated bird CLI.
  Treat the tweet as a seed primary source for what the author said, not as proof that
  every claim is true. Infer the underlying research question, identify the named entities
  and claims, then expand into a full generative-research article using primary sources
  outside X/Twitter.
  ```
- **Twitter 分析员自动派**：在 `hourly-twitter.yml` 里，每轮推送成功、后端是 claude 时跑三步，三步都是 `continue-on-error`。
  1. 节流：`gh run list` 数过去 24 小时 generative-research 的 workflow_dispatch 事件，≥2 次，或离上一次不到 10 小时，就跳过。手动派的也算在额度里。
  2. 选题：Opus，`--max-turns 10`，只读今天的 `research/twitter/<date>.md` 和 `index.json` 最后 30 条。判据原文：
     ```
     Be conservative: skipping is the default, not the exception.
     Step 3 — pick ONE topic OR reject all. Hard bar for selection:
       - Concrete: named entity (person, model, company, paper) +
         specific verifiable claim + dated primary source
       - Primary-sourced inside the twitter file (the "Evidence"
         bullets cite a primary like an IR page, paper, official
         tweet from a named principal — not commentary)
       - Has a "Watch" list under the story (signals ongoing
         developments worth tracking)
       - Does NOT overlap with anything in the recent index
         (compare by topic / tags / title — be strict)
       - Substantive enough for a 4500–7000 word analyst piece
         (a one-tweet rumour does not qualify, even if dramatic)
     ```
     输出一行不超过 140 字符的题目，或者 `NO_TOPIC`。
  3. 派发：程序截到 200 字符，`gh workflow run generative-research.yml -f topic=...`。只传题目，不传推文链接和分析员找到的证据，长文从零开始搜。

  上限是每月约 60 篇，9 月实际一共 12 篇，其中 6 篇的 `source` 是 `workflow_dispatch-twitter-url`，是带推文链接手动派的（自动派不传链接）。剩下 6 篇记成 `workflow_dispatch`，自动派和只给 topic 的手动派在 index 里分不开，所以 9 月自动派最多 6 篇。
- **research-issue.yml** 是另一条线：`research` 标签，Sonnet 5.5，有 key 时挂 Exa/Perplexity MCP，30 分钟超时，写 `research/issues/<n>-research.md`。那是技术选型报告（Executive Summary / Key Findings / Tools & Libraries / Code Examples / Next Steps），不查旧文，不过发布门，仓库里只有 3 份。

### 动笔前查旧文

`scripts/prior_context.py` 225 行。只读 `index.json` 的元数据，不读正文，也不用 embedding：
```python
WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-]{1,}")   # 长度 >2，去停用词
s = (
    3 * len(topic_tokens & tag_tokens)       # tag 权重 3
    + 2 * len(topic_tokens & title_tokens)   # 标题 2
    + 1 * len(topic_tokens & prompt_tokens)  # 当初的 prompt 1
)
# --min-score 2，按分数取前 --limit 5
```
每条命中输出 slug、title、model、date、prompt、文件路径，加上从 HTML 里抽出的标题和 lede 前 400 字。整块包在 `<<<UNTRUSTED_PRIOR_ARTICLE … END_UNTRUSTED_PRIOR_ARTICLE>>>` 里，抽取前先剥掉 HTML 注释，正文里出现的围栏标记会被替换掉。中文 topic 一个 token 都抽不出来。

提示词里只有 step 0.a 这一处用到它，加上脚本自己打印的头：
```
a. Run `uv run python scripts/prior_context.py "$(cat .gen-input/topic.txt)"`
   and Read any high-overlap article files it returns.
   Note what's already covered so you don't duplicate.

# When researching, do not re-derive what these already cover. Build on them,
# update with fresh facts, or deliberately depart. The full text of each lives
# at the file: path below — use the Read tool when you need detail.
```
没有续写、引用旧文、写出「和上次比变了什么」的要求，作用只有防重复。抽查的三篇近作，正文都没有回指旧文。

另有一套 claim store：`build_claim_index.py`（356 行）把每篇的 `claims.json` 并成 `research/claims/index.json`；`claim_search.py`（335 行）做 BM25 检索、按 host 或 URL 查，`--candidates` 列出同单位但数字不同的冲突候选。每条记录带 `reusable`，不可复用时给 `reuse_block`（volatile、contested、single-source、no-as-of、low-confidence），规定这些必须重新核实。CLAUDE.md 写「agent 研究前先跑它」，但 generative-research.yml 和三份其他后端的提示词里都没有调用它（grep 为零），实际没接上。

### 取材

- **歧义检查**：topic 是光秃秃一个词、prompt 里没有任何实体或问题、两边都没点名具体对象，三条全满足才不做全量研究，改出一篇「Scope Clarification」短文（1500–2500 词，给三个具体方向）。默认放行。
- **计划**（只留在上下文里）：10–18 个可回答的问题，每题写明什么算 primary；3–5 个证伪问题；每题预估数据形状。再把题目归进 8 个领域之一（semiconductor、biotech、finance、crypto、policy、infra、software、general），领域决定子 agent 的专家角色字符串和来源优先表，例如 finance 是 EDGAR、电话会、IR、FRED。
- **证据波次**：子 agent 每波最多 8 个（自托管 runner 并发超过约 10 个 Task 就 OOM），一共 16–32 个，分 2–4 波。每个子 agent 最多交约 10 个证据包，格式是：
  ```
  - claim: <the factual assertion in one sentence>
  - source_url: <URL the agent actually fetched>
  - source_type: primary | secondary | commentary
  - date: <YYYY-MM-DD when published or claim was made>
  - figure: <the exact number, name, or date the claim turns on>
  - excerpt: <verbatim quote, <40 words>
  - confidence: 1 (rumour) … 5 (multiple primary sources)
  - caveat: <what would weaken or contradict the claim>
  - shape: one of {single-fact, time-series, ranking, breakdown, paired-delta,
    cross-entity-categorical, pictogram, key-value, chronology, quote}
  ```
- **工具**：
  - WebSearch、WebFetch。
  - `research_search.py`（964 行）：arxiv、edgar、crossref、semanticscholar、github、wikidata、uspto（走 Google Patents）、jedec（Wikipedia 加 Bing）、predictionmarket（Polymarket）、gdelt、nonenglish（GDELT 按语种过滤），都是免费公开接口。提示词要求有学术、SEC、GitHub 痕迹的题目先用它，再用 WebSearch。
  - `curl -sL <url> | pdftotext | head -c 60000` 读 PDF。
  - `source_cache.py`（944 行）：URL 规范化（去掉 utm_*、fbclid，query 排序）后取 sha256 做键，默认 TTL 30 天，PDF 另存一份 `.txt`。同一次运行的子 agent 共用缓存，缓存目录不进 git。
  - `birdy search`、`birdy user-tweets`：点名当事人（创始人、官方账号、项目主力）的推文算 primary。
  - 财报电话会的逐字引语算 primary。
- **外链和论文**：没有程序层的「跟外链」机制。种子模式要求抽出推文里的链接和实体，再到 X 以外找原始材料；论文靠 research_search 的 arxiv、semanticscholar、crossref 加 pdftotext。跟哪些链接、跟几层，全由模型决定。
- **怎么算够**：没有程序判停。主 agent 先建账本：按 URL 去重；confidence < 2 的丢掉，除非是某个问题唯一的信号；按计划问题分组。然后亲自重抓 5–8 个最承重的 primary，核对数字确实在页面上。目标写在提示词里：计划问题回答率 ≥85%，不同来源 URL ≥20，primary 占比 ≥50%，每千词 ≥12 条带引用的断言。真正卡住发布的只有 refs ≥20 和引用密度 ≥10/千词两条，不够时提示词的说法是「run more research waves」。
- **上限**：主 agent `--max-turns 120`；模型步 wall-clock 90 分钟；Claude 失败时恢复重试一次（RECOVERY MODE，读盘上的草稿接着做，不重新研究），fable-5 不重试。

### 成稿

流程：
1. 写 claim ledger（`.gen-claims-ledger.json`）。只放论点依赖的断言，每条有 type、source_urls、对应的 source_tiers、as_of、confidence、risk；metric、forecast、comparison 类型和 volatile、contested 风险的必须有 as_of。
2. 大纲 5–10 个 `## N.` 节，每节一句论点。把证据包按数据形状分给可视化组件，写成路由表（例如「:::stats 用包 4、8、11」），写手只照表填。
3. 每节派一个写手子 agent，每波最多 4 个，每节 600–1100 词。写手拿到完整大纲（避免重复）、本节的包和路由表。每节契约原文：
   ```
   each `## ` numbered section must contain:
      - 1 section-thesis sentence
      - 3–6 sourced factual claims (each with `[^N]` cite)
      - ≥ 1 quantitative datapoint where one exists
      - ≥ 1 counterpoint or "what would weaken this" line
      - 1 sentence on why this matters
   ```
4. 主 agent 缝合：frontmatter（eyebrow、title、deck、lede、stats）；开头用 `:::kv` 或 callout 给 3–5 条直接回答；最后一节「什么会推翻结论」由主 agent 自己从账本写；文末 `:::references`，每条 `{id, title, url, source, date}`，都由模型写。正文每个实质断言后跟 `[^N]`。
5. verifier 子 agent：逐个 `[^N]` 抓引用的 URL，再做 2–3 次去掉原站域名或只搜关键数字的搜索。找不到独立佐证或数字对不上，即使原 URL 支持也判 weak。输出 `.gen-verifier-findings.json`，每条带正文里的原句。
6. 红队子 agent，原文节选：
   ```
   > "You are an adversarial reviewer. Your job is to
   > FALSIFY the article's 3 strongest factual claims.
   > ... For EACH claim:
   >   1. WebSearch + WebFetch for explicitly
   >      contradicting evidence. Try at least 3-5
   >      distinct searches per claim: with
   >      `-site:{cited_url_host}`, with alternative
   >      phrasings, with recent dates appended for
   >      updates, with related-but-different framings
   > ...
   > Do NOT rewrite the article. Do NOT add new claims.
   ```
   severity 分三级：primary 来源反驳是 high，可信二手来源是 medium，只有评论是 low。红队失败时必须写 3 条带 `redteam_failed: true` 的占位，不许写 `{"findings": []}`，免得被读成「三条都没被推翻」。
7. 有限修订一次：unsupported 断言和 high 级反驳，要么换成账本里有支持的说法，要么整句包成 `==unverified: …==` 或 `==contested: …==`，要么删掉。不许借机扩写。

程序门在 `check_generative_research.py`（2,653 行）。模型在提交前自己跑，writer 提交时再跑一遍，推送前 workflow 还有三道（post-write gate、verifier audit、methodology gate）。任何一道失败都 `git reset --hard` 回到运行前，不推送。具体检查：
- DSL 编译、组件白名单、正文 ≤200KB；
- 可视化 ≥3 种、callout ≤5 个；
- 引用密度 ≥10/千词，引用 ≥20 条；
- qsanity 只警告：饼图合计 >105%、份额 >100%、同比 >1000%、远期日期笔误；
- verifier 审计：每条 unsupported 断言生成一组探针（80 字前缀、≥5 词的分段、每个 8 词 shingle），只要某个探针在正文里的出现次数多于在 `<mark>` 里的次数，就算没降级，整篇不发；
- derived 断言（公式推算）在白名单 AST 里重算，误差、引用环、依赖深度都要查。

兜底：没有降级版成品，失败就不发，推 Telegram。主题太泛时出的 Scope Clarification 短文也要过 refs ≥20 和引用密度门。

长度目标 4500–7000 词，提示词说只是护栏。抽查三篇近作：

| 篇 | 词数 | references | 节数 | verifier（supported / weak / unsupported） | 红队 |
|---|---|---|---|---|---|
| Reflection Beam（10-05） | 5,870 | 43 | 8 | 66 / 9 / 2 | 2 条未推翻，1 条 low |
| OpenAI 722 篇数学稿（10-07） | 5,480 | 53 | 9 | 58 / 23 / 3 | 3 条未推翻 |
| Google Suncatcher（10-02） | 8,263 | 52 | 9 | 58 / 12 / 3 | 1 条未推翻，medium、low 各 1 |

5 月的早期作品（cerebras）只有 2,423 词、16 个引用标记，这些门是后来加的。每篇成品是一个 HTML 片段，加 4 个旁文件：`.ara.md` 源文、`claims.json`、`verification.json`、`redteam.json`。

### 翻译

每篇发布成功后自动派 `translate-generative-research.yml`（`auto_merge=true`），也能按 slug 手动补。走 Cursor Grok 4.6 fast（`generative-translation` route，fallback none）；作业超时 100 分钟，模型步 80 分钟。

模型不碰结构，过程如下：
1. 程序编译 `.ara.md`，只暴露读者看得到的文本槽，把数字、URL 等不可变字面量换成不透明 token `⟦ARA0000⟧`。
2. 模型读一份 JSONL（`[segment_id, source_text, flag]`），只写 `{id, text}`。它没有 shell、网络、搜索和子 agent。
3. 程序校验：每个 id 恰好出现一次；token 恰好出现一次且顺序不变；除了数字贴着韩文（`9일`）以外，不许出现裸数字。然后重建 HTML。
4. `check_generative_translation.py`（292 行）比对源文和译文的数字、URL、脚注、指令是否对等。
5. 用同一个 writer 发布，开 PR 自动合并。

提示词节选：
```
Preserve every opaque token such as `⟦ARA0000⟧` exactly once and in its original order.
- Do not invent raw digits. Source numbers are already opaque tokens. The only allowed
  untokenized digits are an integer glued to Hangul (`9일`, `3배`). Never write `$1,000`,
  `2.5`, `30%`, `2026`, or any other bare number.
- Do not browse, research, add claims, add sources, drop sections, edit the English
  source, or write any other file.
```
三篇韩文版的提交时间比英文版晚 14、22、32 分钟。

### 成本和耗时

仓库里没有单篇的花费或耗时记录。能找到的：
- 默认 Opus 5.5 走订阅 OAuth，注释说在 OAuth 下重试一次「costs no more than the first would have」。
- OpenCode Go 路线的文档说一次深挖只占周额度（30 美元）的一小部分。
- 歧义短文那段注释写「caps the run at a few minutes instead of 30+」，可见正常一次在 30 分钟以上。
- 早期不限并发的版本跑了约 19 分钟就把 runner 拖得失联，这才加了每波上限和 90 分钟硬上限。
- 一次运行的子会话数：研究 16–32 个，写手 5–10 个，加 verifier 和红队各 1 个，合计 23–44 个。

### 对「详细资料 → 合订本」的启示

**可以搬的**（MIT，保留版权声明）

1. `prior_context.py`（225 行）。改成查本 topic 已有的合订本和文档：按标题、tag、来源 URL 打分，阈值 2、取前 5，中文按二元组分词。比它多一步：按规范化 URL 精确比对，已经装进旧合订本的原文直接标出来（claim store 的 `by_url` 就是这个用途，只是 ARA 没接上）。提示词补上 ARA 没有的一条：指南要写清这本比上一本多了什么。
2. 计划步约 20 行提示词：10–18 个问题、3–5 个证伪问题、每题写明什么算 primary。加上推文种子模式那段约 20 行，「推文只证明作者说了什么，顺着链接和实体到 X 以外找原始材料」，正好是我们「顺着帖子往下挖」的说法。
3. 证据包 schema 约 40 行，改成材料候选，见下面铁律那条。
4. 判停改成程序数：每个计划问题至少一份 primary 材料，每个证伪问题至少一份对立材料，材料总数有上下限。不够时程序把缺的问题号还给模型，再搜一轮。ARA 把这件事留给模型，硬门只数引用。
5. `source_cache.py` 的 `canonicalize_url` 和追踪参数表，约 80 行，接到摄入和 fulltext 的键上，同一篇不会因为 utm 参数进两次。
6. 翻译的段落化加不透明 token 加对等检查（`generative_translation_segments.py` 471 行、`check_generative_translation.py` 292 行，核心约 250 行）。67 的翻译已经定了「编号占位符、模型不写标签」，还可以补两条：数字和 URL 一律 token 化；源文和译文的数字、URL 集合必须对等。合订本第一部分是双语，直接受益。
7. verifier 审计的探针法（`_claim_probes` 加 `audit_verifier_findings`，约 120 行），用来查阅读指南：指南里每句引原文的话，按 shingle 回原文必须找得到。中文改成按字数切窗。
8. `research_search.py` 里 crossref、github、gdelt、polymarket、wikidata 的取数函数，每个 30–60 行，给 tasking 当工具。arXiv、S2、OpenAlex 我们已经有插件，不重复搬。
9. 自动派的节流（约 30 行 bash）和选题硬标准（约 20 行），留到将来秘书主动提议深挖时再用。现在的入口是用户开口要，用不上。

**不适合的**

- 产物不同。ARA 产出模型写的 5,000–8,000 词长文，原文不留（缓存在 gitignore 里）；我们产出收原文的合订本，模型只写阅读指南、决定选哪些节。所以分节写手、可视化路由、组件 DSL、引用密度、refs ≥20、字数护栏都不要。
- verifier 和红队查的是模型写的断言有没有依据。我们的正文就是原文，不用逐条核实。红队的思路挪到取材阶段，变成「证伪问题必须找到对立材料」。
- 16–32 个子 agent 分波并发：桌面和手机都撑不住这个成本和并发。tasking 用一个 agent 多轮工具调用，轮数沿用 `TASKING_TURN_ROUNDS` 那套。
- WebSearch、Exa：tasking 已定不引搜索供应商。X 搜索走桌面 webview，免费 API 走 iOS 直连。
- 多后端、Fireworks 预检、OAuth 恢复重试：不需要，续跑由 pi-durable 管。
- 8 个领域写死专家角色和来源表：换成研究室章程给的视角和来源优先表。

**铁律下怎么改**

ARA 让模型在证据包里写 `source_url`，在 references 里写 title、url、date，再派 verifier 重新抓回来核对。我们反过来：
- 抓取层每取到一页就登记 `M<n>`：URL、规范化 URL、标题、作者、发布日期、内容哈希，以及按标题边界切好的节 `M<n>.§k`。模型只交编号。
- 材料候选：模型回 `{id: "M3", role: primary|secondary|commentary, answers: [问题号], why}`，URL、标题、日期都由程序从登记表里取。
- 选节：模型回 `{material: "M3", sections: ["M3.§2", "M3.§5"], whole: false, order: 2}`，程序校验编号存在再装订。附录、目录、篇末「全文见附录 A.n」、封面底行的来源、篇数和日期区间，全由程序生成。
- 指南里的数字和日期必须出自它点名的那节。程序用 `check_generative_translation.py` 的 `NUMBER_RE` 抽出指南里的数字，在对应节里找不到就打回。ARA 的 qsanity 只警告，我们要拦。
- 旧合订本也编号（P1…）。模型说「P2 已讲过 X」时只写编号，程序渲染成链接。

## 10. 对我们的结论

**对应关系**

| ARA | 我们 |
|---|---|
| lane 当日文件 | cable。差别：它是模型汇总，我们是原料 |
| 日报 | 盒封面 |
| model ticket | 态势里的 judgments（我们已有 `supersedes` 链）和 observables |
| Twitter 分析员读今天已写段 + 昨天全文 | 分析员读态势摘要（`PICTURE_SUMMARY_CHARS = 3000`）。我们更结构化 |
| explorer | 招募员的「已入选源的外链」通道加 add 那道闸 |
| liveness | 采集经理的源健康（未做） |
| daily-improve | 督查周审（未做） |

**可以直接搬的**（MIT，搬时保留版权声明）

1. `scripts/dedupe_headline_alerts.py` 中的 normalize、tokens、`duplicate_reason`、filter，核心约 200 行（全文 457 行），连同测试 `test_dedupe_headline_alerts.py` 530 行，改写成 TS 放进 `src/info/collect/`。用途是 cable 跨日去重，以及 [65](../info/65-加工手册：常态模型、日更列表、滚雪球与稿.md) 日更列表的 recurring 标记。要改两处：中文按二元组分词；判同时序用程序给的入库时间。
2. `scripts/headline_judge.py` 的 shortlist 和 apply，约 150 行，加判官提示词约 45 行。为了守铁律，改成模型只回 `{id, verdict, confidence, matched_id}`，id 是程序编的号，不再按 URL 对号。
3. `scripts/explore_twitter_accounts.py` 的 `candidates_from_tweets` 评分，约 110 行，用于招募员。「受信账号 @ 过它」泛化成「受信源正文里的外链域名或 handle」。
4. `scripts/curate_twitter_accounts.py` 的 propose/apply 分离和「加 5 删 2」上限，约 150 行。闸从 PR 改成对话里的候选卡片，点头生效。
5. `scripts/check_lane_content.py`（482 行）和 `check_lane_freshness.py`（440 行）的核心约 150 行，加 `data/artifact-slos.json` 的结构，做成每个源的健康：cadence、新鲜度、空壳检测。还有一条要一起搬：区分「没取到」和「没新内容」，这是 birdy 的 `unfetched_accounts` 教训。
6. `docs/model-tickets.md` 里的生命周期和关单规则，约 100 行文本，直接用到 judgment 和 observable 上。
7. `prompts/twitter-analyst.md` 里 adversarial pass、high-stakes triage、signal-only 三段，约 50 行，并进 `src/info/analysis/analyst.ts` 的提示词。
8. `daily-improve.yml` 的「必须指出具体缺陷，否则输出 no improvements」，约 60 行提示词，留给督查。

**我们缺而它有的，按优先级**

1. 跨日去重加争议带判官。日更列表的 recurring 计数也依赖它。
2. 源健康看门狗：每源 cadence、空壳检测、没取到和没新内容分开，异常进盒或通知。
3. 分析员失败时的兜底：程序版封面，照抄命中列表并标出是兜底版。不能静默缺盒。
4. 态势条目的生命周期和自动关闭。不加的话态势会无限长，ARA 的 160KB wiki 页和「Skipped for budget」就是反例。
5. 招募员的受信背书评分加提案闸。
6. 后端回退的判据：探活只判鉴权，真限流在调用之后按「零产出」判。
7. 周级自审。优先级最低，ARA 自己只有 1/32 的合并率。

**不适合的和替代**

- **GitHub Actions 加自托管 runner 常驻**：换成桌面 app 当夜间采集端，用 legion schedule 加 durable run 定时；iOS 只做回前台补跑和读盒。
- **git 当数据库**（main 只收 PR、自动合并、冲突留给人）：我们用每设备一个 SQLite 加同步，由采集经理单一写入，不需要 rebase 重试。
- **只盯 AI，写死在多处**：账号名单、7 个搜索词、日报栏目、提示词里的「AI-only」都是写死的。我们改成章程驱动：研究室章程生成源清单和可观测项，提示词参数化。
- **Birdy 走 cookie**：换成桌面 webview 读 X List。
- **Exa/Perplexity**：不做。
- **最终日报的文字、各源计数、URL 都由模型写**：违反铁律。我们坚持程序渲染、模型只按编号选。
- **用不上的**：多后端 A/B、canary、DSL 组件、TTS、头版 PNG、Railway 看板。Telegram 推送换成盒子。

## 没查完的

- hourly-rss 和 community 两条 lane 的具体提示词没读。
- generative-research 的 Codex、OpenCode、Cursor 三份提示词（`.github/{codex,opencode,cursor}/prompts/generative-research.md`）没和 Claude 版逐段比。
- 长文子 agent 自己有没有轮数上限，没核实。
- 长文单次的实际耗时和花费没有数据；自动派实际成功了几次，index.json 分不出来。
- claude-code-review 会不会自动审 explorer 的 PR，没核实。
- Claude 订阅的具体档位不详。
- 判官的验证集 `judge_eval_cases.json` 里有几条用例没打开看。
- 分析员写出的 URL 是否另有程序核对，只看了 `validate_twitter_public_output.py`，没在别处继续找。