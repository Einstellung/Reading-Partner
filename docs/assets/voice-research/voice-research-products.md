# 语音简报产品调研

> 复核 docs/27「新闻那一侧」的断言，并挖已有产品的交互细节。全部外部事实带出处 URL，查证日期一律 2026-08-09（本次抓取当天）。证据强度标在每条后面：官方文档 / 详细评测 / 用户报告 / 未查证。
>
> 工具限制：本 session 的 WebSearch 额度已耗尽，只能 WebFetch。可用的检索替代是 Google News RSS（`news.google.com/rss/search`）、Bing 的 `&format=rss`、DuckDuckGo lite（会触发验证码）、各站自带的 `?s=` 站内搜索。中文站（36kr、微信、得到）基本抓不到，相关结论标了"查不到"。

## 断言的复核

docs/27 说"念简报的时候插一句问刚才那条，没有产品做这件事"。精确的现状是：**这个形态已经有产品做出来了，但不在新闻简报域**。

Google 的 NotebookLM（2026 年已改名 Gemini Notebook）的 Audio Overview 有 Interactive Mode：播放中点 Join，主持人会点名叫你提问，答完接着念。官方帮助文档原文："Select Interactive mode... tap Join while listening... When the hosts call on you, ask your questions"，并说主持人依据你的来源作答"before resuming the overview"（官方文档，https://support.google.com/gemininotebook/answer/16212820）。发布公告同样写"A host will call on you to ask your question"，主持人"listen attentively, and then respond directly, drawing from the knowledge in your sources"（官方文档，https://blog.google/technology/google-labs/notebooklm-new-features-december-2024/）。

但它念的是用户自己上传的资料，不是每天变的新闻简报；而且只有英文（官方文档，同上帮助页："The interactive mode experience is currently available only in English"）。

新闻那一侧，2025–2026 出了两个正面产品，都**只有屏幕交互，没有语音插问**：

- Google Daily Listen（2025-01 起 Search Labs 实验）：约 5 分钟、依据 Discover 兴趣生成，播放器有播放/暂停、后退 10 秒、下一条、倍速、带分段标记的进度条，封面位置显示文字转写；底部按段列"Related stories"，可以 thumbs up/down 和"Search for more"（详细评测，https://9to5google.com/2025/01/08/google-discover-daily-listen/）。仅美国、仅英文、仅手机（详细评测，https://www.androidpolice.com/google-daily-listen-setup-guide/）。全文未提任何提问能力。
- Google News Audio Briefing（2025-12 起 Android 上的 Listen 标签）：两个 AI 主持人讨论当天新闻，样例约 13 分钟六条，来源含 The Guardian、Washington Post、Der Spiegel；播放器有倍速、后退 15 秒/前进 30 秒、"Jump to next subject"、可缩成迷你播放器和通知栏控制；当前条的标题显示在顶部，带"See featured article"和"Full Coverage"；三点菜单只有"Send feedback"（详细评测，https://9to5google.com/2025/12/17/google-news-audio-briefing/）。同样没有提问。

所以断言要改写成：**念结构化内容中途插问已被 NotebookLM 验证可行；把它接到每日新闻简报上，2026-08 仍然没有产品做。**

## 四样缺失逐一核对

**当前念到哪一条的追踪 —— 已被解决，可以直接抄。** Google News Audio Briefing 有"跳到下一个话题"，并且播报到哪一条，顶部就显示那一条的标题和进原文的入口（详细评测，9to5Google 2025-12-17，同上）。Daily Listen 的进度条按段落打标记，底部随播到的段落换"Related stories"（详细评测，9to5Google 2025-01-08，同上）。两者都是屏幕上的当前条追踪，不是语音里的。

**插问之后怎么回到原处 —— 播客域已解决。** 官方文档只说答完 resume。实测描述更具体：主持人"answered the question... and seamlessly switched to the main discussion"，作者说"I didn't even realize that it had happened"（详细评测，https://www.androidpolice.com/notebooklm-interactive-audio-make-me-feel-like-i-have-a-private-tutor/）。官方同时承认会有尴尬停顿和偶发错误："Hosts may also pause awkwardly before responding"（官方文档，blog.google 2024-12-13）。

**播放中间"改变明天"的手势 —— 部分解决，两个不同的答案。** 屏幕侧是 Daily Listen 的按段 thumbs up/down（详细评测，9to5Google 2025-01-08）。语音侧是 Spotify 的 DJ：按住播放器右下角的 DJ 按钮，"You'll hear a beep when DJ is ready"，然后说出请求，DJ 会"update your session based on your request, listening history, music preferences"（官方文档，https://newsroom.spotify.com/2025-05-13/dj-voice-requests/）。仅英文、Premium、60+ 市场；2025-09 起 Android Auto 上有"Talk to DJ"按钮（官方文档，同上）。注意这只改当前 session，不是写死的长期偏好。

**知道用户已经读过什么 —— 没有任何产品声明这件事。** Daily Listen 和 Audio Briefing 都从 Discover 兴趣生成，但没有一处文档或评测提到"这条你在文字流里读过所以不念"。（未查证：没有反面证据说它们不做，只是查不到任何声明。）

## 纯语音下怎么表达带副作用的动作

这是 docs/27 那条规矩（语音侧只给只读工具）的对照面。查到的只有三种模式，没有一种是"口头确认"：

1. **物理手势当闸门。** Spotify DJ 是按住按钮说话，手势本身就是明确意图，说完立即生效，没有任何口头确认环节（官方文档，Spotify newsroom 2025-05-13）。副作用是可逆的（换回去就行）且只影响当前 session，所以敢不确认。
2. **不提供。** Alexa Flash Briefing 用的是预建交互模型（prebuilt interaction model），开发者不能加自定义意图，也就没有任何"这条别再给我"的说法；条目之间只用一个 earcon 分隔，文档通篇没有 next/skip/previous 之类的播放中命令（官方文档，https://developer.amazon.com/en-US/docs/alexa/flashbriefing/understand-the-flash-briefing-skill-api.html、https://developer.amazon.com/en-US/docs/alexa/flashbriefing/flash-briefing-skill-api-feed-reference.html、https://developer.amazon.com/en-US/docs/alexa/flashbriefing/tips-for-creating-a-great-flash-briefing-skill.html）。源的增删只能回 Alexa app 里做。（Amazon 的用户帮助页 amazon.com/gp/help 抓不到，返回 503，所以"用户实际上能不能对 Alexa 说 next"未查证。）
3. **对话里顺口收。** Alexa 设计指南的 Gathering feedback 模式是把评价接在任务结束后的对话里问，不做成单独一步；Lists 模式是一次只报 5–6 条，靠"more"翻页（官方文档，https://developer.amazon.com/en-US/alexa/alexa-haus/patterns-and-components）。这两条都是只读式的，不涉及写偏好。

没查到任何产品用"AI 口头复述一遍再等你说是"来落语音里的偏好写入，也没查到语音"撤销"。docs/27 的规矩（副作用落到屏幕上等确认）在业界没有反例可抄；能抄的只有 Spotify 那条：**用一个按住的手势替代确认卡，并且把副作用限定成可逆、只影响眼下这一次。**

## 播报中断之后

- 查不到任何产品对"听到一半走开了，回来怎么办"有专门设计。Google News Audio Briefing 有迷你播放器和通知栏控制，即普通播客续播（详细评测，9to5Google 2025-12-17）；Alexa Flash Briefing 文档里没有 resume 的说法（官方文档，同上三份）。
- 值得抄的是 Snipd 的做法：不打断播放也能留下持久痕迹。它把耳机原有的"上一曲/后退"键改成 snip 键（AirPods Pro 三击、Galaxy Buds 三连点、Sony XM4 用 Sony app 自定义按钮），触发后有一声音频确认，AI 自己判断刚才哪一段相关并生成摘要、转写、说话人（官方文档，https://support.snipd.com/en/articles/10225450-create-snips-with-your-headphones；产品页 https://www.snipd.com/ 写"tap your headphones whenever you hear something worth remembering"）。回捞多少秒、事后能不能调整范围，官方帮助页没写（未查证）。

## 其它查过的产品

- **小智（github.com/78/xiaozhi-esp32）**：README 里没有任何"念一份有结构的内容被打断再恢复"的状态管理，只有唤醒、级联/端到端管线、AEC 硬件才支持全双工（官方文档，https://github.com/78/xiaozhi-esp32）。它的 MCP 文档全是 IoT 控制工具（音量、亮度、拍照、重启、截屏），没有任何播放位置或续播状态（官方文档，https://raw.githubusercontent.com/78/xiaozhi-esp32/main/docs/mcp-usage.md）。这条路上没东西可借。
- **Podwise**：全是听完之后的产物——摘要、转写、脑图、Ask Anything 问答、导出到 Notion/Obsidian。官网没有任何收听中的交互（官方文档，https://podwise.ai/）。
- **Spotify 播客 AI（2026-05-21 上线）**：可以就正在听的这一集或其中提到的概念提问；另有"briefing generation"，让用户按日/周排程生成一份自定义提示词驱动的个人播客（例如"Share my daily city updates, and tell me about local concerts from artists I love"）。仅 Premium、仅美国/瑞典/爱尔兰移动端。提问是打字还是说话、提问时播放是否暂停，报道没写（详细评测，https://techcrunch.com/2026/05/21/spotify-adds-ai-powered-qa-and-briefing-generation-features-to-podcasts/）。**这是最接近我们形态的一个，但关键的交互细节未查证。**
- **Apple News+**：只有"professionally narrated versions"的人声朗读稿，产品页没有任何 AI 或交互描述（官方文档，https://www.apple.com/apple-news/）。想找的 Apple 支持文档抓错了页，交互细节未查证。
- **Artifact（已关停 2024-01，被 Yahoo 收购）**：有 AI 配音朗读全文（含名人声音），有"标记标题党由 AI 重写标题"这个反馈手势。所有反馈都是屏幕上的，与语音播报无关（详细评测，https://en.wikipedia.org/wiki/Artifact_(app)）。
- **Google Assistant "Your News Update"（2019-11 上线，2021-11 关停）**：说"Hey Google, play me the news"即时生成个性化播放列表，短条目后面接长篇深度，42 家出版商。播放中的语音命令报道没写（详细评测，https://9to5google.com/2019/11/19/assistant-your-news-update/、https://9to5google.com/2021/11/05/google-assistant-your-news-update/）。这个形态被 Google 做过、关掉过、2025 年又以 Daily Listen / Audio Briefing 的样子做了回来。
- **国内产品：没查到任何一个做"AI 念新闻简报可中途插问"的。** 微信"听一听"是 2024 年内测的音乐音频一级入口，不是 AI 简报（详细评测，36 氪 2024-01-18 / 2024-06-28，经 Google News RSS 索引）。小宇宙的 AI 是"问问小宇宙"这类文字检索（用户报告，53AI 2024-09-03）。豆包 2025-06 上线的 AI 播客是文档转播客（NotebookLM 那一类），没有报道提到收听中插话（用户报告，驱动之家/新浪财经 2025-06-17）。豆包 2026-04 升级了全双工实时语音模型（用户报告，雷峰网 2026-04-10），但那是通话不是简报。得到听书、车载语音（理想/蔚来）的新闻简报交互，用现有工具抓不到中文资料，未查证。

## 值得抄的

**一、当前条要在屏幕上有身份。** 播到哪一条，顶部就是那一条的标题加进原文的入口，进度条按条打标记，底部随当前条换相关内容。Google 两个产品都这么做（9to5Google 两篇）。这直接解决"插问时 AI 知道你问的是哪条"——不需要靠语义猜，播放器的当前条就是上下文。

**二、按住说话的手势兼作确认。** Spotify DJ 的"按住按钮 → beep → 说 → 立即生效"是唯一查到的、语音里改变后续内容的成熟设计（Spotify newsroom 2025-05-13）。beep 那一下是关键：它告诉用户"从现在开始录的话会当成指令"，这就是语音里的确认卡。我们要做"这条明天别再给我"，可以用同一个骨架——手势明确、只改可逆的东西、AI 口头复述一句作为回执。

**三、不打断播放的持久化动作。** Snipd 把耳机既有按键改成 snip 键，一声 earcon 就完事，音频不停（Snipd 帮助中心）。听简报时"记一下这条"应该是同级别的成本，不该变成一次对话。

## 明确要避开的坑

**不要做成两种播放模式。** NotebookLM 的互动是独立入口（挥手图标 vs 播放按钮）。用普通播放键播了就不能提问，得退出去点挥手图标、等 5–10 秒重新起播、再拖到刚才那个时间点才能问（详细评测，Android Police 2026-04-06）。我们的简报只能有一种播放，随时可插问。

**回答前的静默要有交代。** 官方自己承认主持人会在回答前尴尬停顿（blog.google 2024-12-13）。级联管线的 600–900ms（docs/27）再加上思考时间，这段静默必须有声音或视觉占位，否则用户会以为没听见而重复问。

**纯个性化会被骂回音壁。** Daily Listen 只从 Discover 的既有兴趣里选题，被评测直接点名有回音壁风险（详细评测，Android Police setup guide）。docs/16 的"破圈位"是对的，语音版也要保留。

**别指望语音里做完整的偏好管理。** Alexa 十年的答案是干脆不给（预建交互模型，无自定义意图）。我们的规矩（语音只给只读工具、副作用落屏）和业界一致，不是保守。

## 未查证清单

- Alexa Flash Briefing 播放中用户实际能说哪些命令（amazon.com 帮助页 503，developer 文档不涉及用户侧命令）。
- Google Assistant / Nest 新闻播报的 next/skip 语音命令（帮助中心搜索页抓不到内容）。
- Apple News+ 音频的播放控件和 CarPlay 行为细节。
- Spotify 播客 Q&A 是打字还是说话、提问时播放是否暂停。
- Snipd 的 snip 回捞窗口有多长、事后能否调整范围。
- NotebookLM Interactive Mode 里，用户说话时播报是真暂停还是继续放低音量。
- 得到听书、国内车载语音助手（理想同学、NOMI）的新闻简报交互。
- Daily Listen / Audio Briefing 是否用"已读"抑制条目。
