# Round 2 / 4 — 结论稿（synthesis）

> 第二轮调研，2026-08-27 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 这一份是三个维度跑完后的结论稿，[45](../../45-陪伴的形态.md) 的正文按它写。原文照录。

---

## 1. TTS：不换，但先量

**结论：第一版留硅基流动 CosyVoice2。**

价格上用户方向对、幅度可忽略。qwen3-tts-flash ¥0.8/万字符、汉字按 2 字符计，折 ¥1.60/万汉字；CosyVoice2 ¥0.05/千 UTF-8 字节、汉字 3 字节，折 ¥1.50/万汉字（https://help.aliyun.com/zh/model-studio/billing-for-model-studio ，https://siliconflow.cn/pricing ）。按 250 字/分钟是 ¥0.0400 对 ¥0.0375 每分钟，docs/33 那份两千字简报 ¥0.32 对 ¥0.30，每天一份一年差七块。realtime 版 ¥1/万字符即 ¥0.0002/汉字，贵 33%，一年 ¥146 对 ¥110。钱不是决策依据。

延迟没有任何支持换的证据。97 ms 出自技术报告 https://arxiv.org/abs/2601.15621 ，测的是开源权重 Qwen3-TTS-12Hz-0.6B 单卡 torch.compile + CUDA Graph、并发 1 的模型侧首包（LM 93 ms + tokenizer 4 ms），不含网络；而托管的 qwen3-tts-flash 现役快照是 2025-11-27，比那套权重开源（2026-01-22）早两个月，没有文档说是同一套。阿里托管侧唯一出现过的毫秒数在实时合成用户指南的 FAQ 排障段——「首包延迟：正常约 500ms」（https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide ），是排障基线不是规格，同页还注明 SDK 量出的首包含 WebSocket 建连耗时。硅基流动一个数都没有。两家在 docs/33「未实测」那一栏上是平的，谁也没赢。

输出形态两边都不用解码，硅基流动更省事。它 `response_format:"pcm"` 给裸 PCM，`sample_rate` 可选 8/16/24/32/44.1 kHz，能挑一个和 VPIO 引擎对得上的，docs/33「直接喂 `AVAudioPlayerNode`」原样成立。qwen3-tts-flash 走 HTTP + `X-DashScope-SSE: enable` 给的是 base64 包着的 PCM，24 kHz/16-bit/单声道且不可选（`format`/`sample_rate` 只存在于 CosyVoice 和 Qwen-Audio-TTS 的请求里），Rust 侧多一层 SSE 帧解析加 base64 解码。int16→Float32 两家都躲不掉，不构成差别。

流式文本输入只有 qwen 的 realtime WebSocket 有，而 docs/33 已明说第一版按句请求整段拿。换过去是多付 25% 买一个当前用不上的能力。

Rust 侧工作量差得明显。硅基流动是 OpenAI 兼容的 `POST {base}/v1/audio/speech`，key 和 base_url 与现有 STT 同源（`/home/xinyuan/Documents/Github/Reading-Partner/src/ai/voice/config.ts`），读 body chunk 往 Swift 送就完。百炼没有 OpenAI 兼容 TTS 端点，只有 DashScope 原生 `/api/v1/services/aigc/multimodal-generation/generation`，要新起一套凭据和客户端；再加一件必须做对的事：400 `DataInspectionFailed`（绿网内容审核，https://help.aliyun.com/zh/model-studio/error-code ）要从网络错误里单独拆出来。念新闻天然踩这个雷，当网络错误重试就是那一句永远静音的循环。realtime WS 更贵：4 个客户端事件、14 个服务端事件、session 生命周期、重连、keepalive，而简报要挂十几分钟、单连接能挂多久文档没写。

唯一真正的差距是音色：qwen3-tts-flash 51 个，含粤语、四川话、京片子、上海话、天津话、陕西话和一批角色音（https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list ），硅基流动八个通用播音音色。砍掉插画后声音是人格的全部载体，这条有分量——但当前范围是早上念新闻，播音音色正是要的，萌宝音念 arXiv 摘要是减分。等 docs/north-star/companion.md 那条「宠物开聊」真排上日程，再拿这条重新决策，那时候连带要决定的是声音复刻（qwen-voice-enrollment ¥0.01/音色，免费 1000 个）。

**要量什么。** 一个丢完就扔的脚本，从与 iPhone 同网络的机器对两家各发 40 句、每句 20 字左右中文，分段记：DNS、TCP、TLS、HTTP 首字节、第一帧可播 PCM（阿里那边是解完 SSE 帧和 base64 之后）、整句收全。另记两个派生量：第一帧里含多少毫秒音频——如果服务端整句缓冲后一次吐，SSE 的「流式」对首字延迟毫无帮助，这是决定「按句接力」成不成立的那个数；以及 RTF（合成耗时/音频时长），必须明显小于 1 否则接力会饿。p50/p90，WiFi 和蜂窝各一轮。curl 的 `-w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer}'` 覆盖前几段，第一帧可播 PCM 要十几行 Python。写脚本一小时，每家每网络跑十分钟，含分析半天。若两家 p90 都在 500 ms 以上，要重新想的是按句接力这个形态，换不换供应商是次要问题。

## 2. Orb：最小的那一版，以及三个前提修正

**前提一：不是 10 Hz 常量。** `plugins/voice/ios/Sources/DictationRun.swift:252` 的 `levelInterval = 1.0/15.0` 是节流上限，实测从没生效过——真正定频率的是 `installTap` 的缓冲区（约 100 ms 音频一次回调），实测 9.6–10.0 Hz。docs/pitfall/161 就是这条。所以「把发送频率抬到 30 Hz 是一行改动」在这个仓库不成立：抬频率要改 `bufferSize`，而那个缓冲区同时是喂 `SpeechAnalyzer` 的那一路（`AVAudioConverter` 之后 `continuation.yield(AnalyzerInput(...))`），动它等于动已经实测通过的 ASR 链路。真要 30 Hz，正确做法是在 `emitLevel` 里把一个缓冲区切 3 个 33 ms 子窗各算一次 RMS，一条事件带一个数组发出去，音频路径一个字节不动，约 15 行。

**前提二：现在这个 level 是麦克风电平，不是播放电平。** 它只回答「用户说话有多大声」。orb 在 speaking 状态要跟着 AI 的声音脉动，那个信号今天不存在——TTS 本身还没写（`src-tauri/src/` 和 `plugins/voice/src/` 里没有任何 TTS 代码，只有 cpal 录音）。

**前提三：这个 orb 是被唤出的，不是常驻的。** docs/33 定死「只做 info 线的每日简报播报，reading 线不做语音」，所以 WCAG 2.2.2 那场「常驻 vs 唤出」的争论在这里不存在。Tailwind 的 `motion-reduce:` 变体一个 class 就把 reduced-motion 那半交代了。

**最小的那一版（v0，不碰 Swift、不碰 Rust）：**四个状态，零音频反应。idle / listening / thinking / speaking，全部由已有的状态机推出来——`holdReducer`（`src/ai/voice/hold-machine.ts`）的 `status` 给前两个，简报 run-state 给后两个。CSS 动画，Tailwind utility，一个 `rounded-full` 的 div 加两三层 radial-gradient。ChatGPT voice mode 传达的九成是「我现在在哪个状态」，这一版就把它交付了。

**v1（免费）：**给 listening 状态接上振幅。`{kind:"level"}` 已经一路走通到 `holdReducer` 的 `state.level`，`src/ui/components/chat/hold-zones.ts` 的 `barHeights` 已经在消费它。orb 只是同一个数的第二个读者，零新增桥。

**v2（等 TTS 落地再做）：**speaking 的振幅。别在 Swift 里给播放装第二个 tap 按帧往外推——按句合成的时候 Swift 手上已经有整句 PCM，顺手算一条 25 ms 窗的 RMS 包络（40 值/秒），随句子开始一次性发过去，TS 侧按本地时钟回放。这条包络和 docs/33 里「按这一句共 N 字、总时长 T 线性插值」用的是同一套机器，本来就要有。一句一条事件，20 分钟简报总共几十条 IPC。

**落在哪。** 纯函数（level → scale/glow、平滑、状态到动画参数的映射）进 `src/ui/components/orb/orb.ts` 配 `orb.test.ts`，渲染进同目录 `Orb.tsx`——`hold-zones.ts` 就是这个先例：ui 层里的纯显示数学，`.ts` 可测。新目录必须在 `tests/layering.test.ts` 的 LAYER 表里登记 `"ui/components/orb": "ui"`，否则第一个测试就红。不产生任何新的跨层边：ui 可以 import capability（`ai/voice`）和 domain（`info/briefing`），状态推导放在 orb 模块里就行，别为了「共用」把它塞进 `ai/voice`——那是 headless capability，显示数学不属于它。

**10 Hz 够不够：够，前提是只画一个会呼吸的团。** 语音包络的调制谱峰在 4–5 Hz（音节率），10 Hz 正好是 Nyquist，每音节两个采样。但一个带 48 ms 起振、167 ms 回落的团，它自己的平滑已经把截止频率压到远低于 10 Hz，眼睛看到的是句子级的呼吸，不是音节。代价是峰值被削平、整体晚约 100 ms，对一个情绪指示器不可见。10 Hz 真正不够的是多柱波形图——那个要看起来像语音，2 采样/音节会露馅。别画波形图。

**平滑的具体数：**60 fps 下 `x += (target - x) * k`，时间常数约 1/(60k)。起振 k=0.35（≈48 ms），回落 k=0.10（≈167 ms），非对称是必须的，否则字与字之间的间隙会让团抖。离开 speaking 状态前挂 400–500 ms 的静默保持计时器，防止状态在句间抖动。写法上别用 React state 承载这个数——`HoldToTalk` 现在每条 level 事件重渲染一次，13 根柱子在 10 Hz 下无所谓，20 分钟简报的 orb 应该走 ref + rAF 写 CSS 自定义属性，一次 re-render 都不要。

## 3. 放弃角色：真正丢掉的东西

先说一个事实：仓库里没有这个角色。`docs/north-star/companion.md` 明写「形象与动画、主动说话的策略也都不在当前基本盘」，八种情绪、五套 idle、能量条从来没有设计文档也没有一行代码。所以这不是删掉已有的东西，是用一个小计划换掉一个大计划，沉没成本为零。

**丢掉的，按值排序：**

逗弄它。`companion.md` 的「可以逗弄它」需要一套会对触摸做反应的美术资产，orb 给不了，也没有便宜的替代。这是唯一真正的损失，也是对一个陪读 app 产品价值最低的一条。

能量条作为 token 预算的显示面。`src/budget/` 是真实存在的能力目录（estimate/fit/ladder），如果预算信号原本打算挂在能量条上，现在它没有出口了。按「conversation is the correction UI」这条既有原则，预算信号落到对话文本里，不加界面元素——但这需要明确决定一次，不能默默丢掉。

辨识度。一个团是通用的。便宜的替代是声音（这正是 51 音色对 8 音色那条真正的分量所在）和一个名字——名字不是美术资产，成本为零。

**没丢的，也是最该说清的一条：**主动说话。`companion.md` 里「它也会主动说说话」是 AI 行为，不是美术。内容来源是主题快照和蒸馏出来的观察（`src/memory/observations/`），一个会发光的团和一只画出来的宠物一样有能力主动开口。这条完全保留，而且是那个愿景里唯一有产品价值的部分。

**两边都说：**支持保留某种角色感的最好证据是 Roomba 那篇（Sung et al., UbiComp 2007，30 户里 21 户给它起名、18 户认为它有意图和性格、3 户在人口表上把它填成家庭成员），但那篇的机制说得很清楚——人抓住的是运动的随机性，不是脸，论文原话是 "a non-lifelike form can also engender strong attachment"。这条同时是「orb 够用」的证据和「美术本来就不是承重墙」的证据。可以便宜保留的就是这个机制：给 idle 一点不规整的漂移（三层 radial-gradient 各自 6s/7.5s/9s 关键帧、负 delay 让它们永不同步，纯 CSS 二十行），而不是节拍器一样的脉动。

反对把身份押在 orb 上的证据是两份讣告：Mico 上线约十个月后于 2026-08-13 从 Copilot 核心语音体验里撤掉（https://www.geekwire.com/2026/farewell-mico-microsofts-cute-little-ai-blob-is-going-the-way-of-bob/ ），而它出厂就是可关闭的、抽象的、非人脸的——正好是这次要换成的形态，照样死了；OpenAI 2025-11-25 把蓝球屏从默认降级为 Settings→Voice→Separate Mode 的遗留开关，现在的官方语音帮助页（18,255 字符，约 2026-08-16 更新）里 "orb" 出现零次。所以：orb 当状态指示器做，别当产品身份做。

最后一条要说破：八种情绪从来就做不到。没有任何一个 orb 实现表达情绪——orb-ui 七个状态、VoiceOrbs 五个、SmoothUI 六个，全是 idle/connecting/listening/thinking/speaking/error 这类会话管道状态；Alexa 做了十年，整个会话回路只用一种蓝色，listening/thinking/responding 靠运动方式区分，离开会话才舍得花一个色相。「8 情绪压缩成 5 状态」不是降级，是删掉一个没有先例证明能跑的设计。

## 4. 法律：真正消失的和自以为消失的

**真正消失的，只有一条。**《生成式人工智能服务管理暂行办法》第十条：「采取有效措施防范未成年人用户过度依赖或者沉迷生成式人工智能服务。」养成机制、亲密度状态、token 喂养的能量条，正是这条针对的那种参与度循环，是对开发者不利的实证材料。砍掉它们就把这份材料从盘上拿掉了。但它今天是休眠的——第二条把整套办法的适用范围限定在「向中华人民共和国境内公众提供」，第二条第三款还明写研发和应用但未向境内公众提供的不适用。TestFlight 上自己一个人用，不在里面。

其余全部是证据权重，不是构成要件。

**自以为消失、其实没有的：**

SB 243。§22601(b)(1) 原文：「'Companion chatbot' means an artificial intelligence system with a natural language interface that provides adaptive, human-like responses to user inputs and is capable of meeting a user's social needs, **including by** exhibiting anthropomorphic features and being able to sustain a relationship across multiple interactions.」"including by" 是扩张性表述不是限定，它修饰的是「capable of meeting a user's social needs」这个要件，而且它自己还是合取的——拟人特征 **和** 跨会话关系。跨会话记忆把后半截完整留着。真正的出口是 §22601(b)(2)(A) 的排除项：「A bot that is used **only** for customer service, a business' operational purposes, productivity and analysis related to source information, internal research, or technical assistance.」承重的词是 "only"。分析用户在读的书是标准的 "analysis related to source information"。威胁它的不是吉祥物，是画像的边界：`src/memory/observations/types.ts` 现在那七种观察（reading-position、stuck-point、cannot-explain、can-explain、understood-concept、belief、correction）全部关于读者对材料的掌握，稳稳落在排除项里；`src/memory/profile/guess.ts` 那种「他要的是对那个时代的判断而不是选股技巧」的心智推断已经在边缘上，只要不往情绪、关系、生活处境延伸就还站得住。这是整份分析里最有后果的一个决定，它是记忆范围的决定，不是美术的决定。

管辖。§22601(e)：「'Operator' means a person who makes a companion chatbot platform available to a user **in the state**.」没有开发者住所要件、没有收入门槛。纽约 GBL §1700(8) 同形（"uses an AI companion for personal use within the state"）。用户只有一个人、在中国大陆，两部法今天都够不着这个 app。把敞口按在零的是用户地理位置，不是角色。

纽约另有一条便宜的出口：§1700(4)(a) 的三个要件由 "and" 连接，(ii) 是「asking unprompted or unsolicited emotion-based questions that go beyond a direct response to a user prompt」。陪读 app 不问这种问题就整个落在定义外。这直接约束 companion.md 那个「主动说话」：主动说书可以，主动问「你今天心情怎么样」就进了 (ii)。写进设计约束。顺带记一笔，一旦进去了，纽约 §1702 的三小时提醒适用于全部用户，不像 SB 243 §22602(c)(2) 只管已知未成年人。

苹果年龄分级。前提是假的：年龄分级问卷里根本没有 AI chatbot 这一项。Capabilities 只有 Unrestricted Web Access、User-Generated Content、Social Media、Social Media Disabled for Users Under 13、Messaging and Chat、Advertising，而 Messaging and Chat 的定义是「Users can directly communicate with **one another**」——人对人。orb 让年龄分级答案改变零个字，记忆功能也是。2026-06-08 版审核指南同样没加任何关于 AI 助手、语音或 companion 的条款。

中国的 AI 内容标识。这条 orb 不但不减，还可能加重。《标识办法》第四条的适用挂在《深度合成管理规定》第十七条第一款，其触发项包括「（一）智能对话、智能写作等模拟自然人进行文本的生成或者编辑服务；（二）合成人声、仿声等语音生成……」。聊天是智能对话，TTS 是合成人声，两条都命中，而语音 orb 形态恰恰把合成人声变成整个产品表面。GB 45438-2025 §5.3 注 3 把语音助手的「起始/末尾位置」定义为一轮交互的起始和末尾，照字面走音频路线就是每一轮都要加「AI生成」语音标识或者「短长短短」的摩斯节奏。出口在 §6：「在内容附近持续显示提示文字」或「在交互场景界面顶部、底部、背景等适当位置持续显示提示文字」，必须同时含人工智能要素和生成合成要素——「AI生成」满足，光一个「AI」角标不满足。落地就是播放控件旁边钉一行字，一个 Tailwind class 的事。今天休眠（第二条的范围闸），上中国区 App Store 那天由《标识办法》第七条在上架审核环节转成对开发者的举证要求，第八条还要求把标识方式写进用户服务协议。这件事要在提审之前做好，不是审核中做。

用阿里的 TTS 不会把标识义务转给阿里。《暂行办法》第二十二条（二）把「包括通过提供可编程接口等方式」提供服务的也算服务提供者，GB 45438-2025 §3.7 同构。两层各是各的提供者，义务叠加不转移；显式标识按用户感知定义，落在 app 这一侧。

苹果 5.1.2(i)（2025-11-13 加入）：「You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so.」这是唯一一条现行有效、这个 app 今天就可能违反的苹果规则——书的正文加蒸馏出来的读者画像发给第三方 LLM、文本发给第三方 TTS。orb 对它零影响；每加一个记忆功能它就重一分。

GUARD Act 不是法（2026-05-11 报出参议院司法委员会，Calendar No. 406；-es/-eh/-enr 全 404）。若按报出版本通过，§5 的义务挂在「any person who makes publicly available to end consumers an artificial intelligence chatbot」上——强制注册账号、对每个用户做年龄验证、每次对话开始时披露非人类，陪读助手全中；只有 §6（禁止未成年人）挂在 "AI companion" 上，而那个定义是合取的，(B) 要求「designed to encourage or facilitate the simulation of interpersonal or emotional interaction, friendship, companionship, or therapeutic communication」，一个讲书的助手不满足。所以砍角色躲得开 §6，躲不开 §5。两处数字要用委员会替代案的版本：披露只剩「at the initiation of each conversation」（30 分钟一次那条被删了），刑事罚则是每次 $250,000（不是 $100,000）。

一句话：三个真正起作用的杠杆是用户地理位置、那把合成的声音、以及记忆里有多少是关于用户而不是关于书。角色一个都不在其中。为了省工程量砍掉它是充分理由，别把它写成法律动作。
