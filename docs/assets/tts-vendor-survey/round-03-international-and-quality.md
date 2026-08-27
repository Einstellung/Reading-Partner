# 国际厂商与质量证据

> TTS 供应商横评的原始输出，机械转写自 JSON，措辞未改。结论已吸收进 [46](../../46-TTS供应商横评.md)。
>
> 本轮的 JSON 是候选表形态（每个候选一组字段加一个 sourceUrl），不是 companion-research 那种一条 finding 一个 Source/Date/Confidence 的形态，逐条日期与置信度在源数据里就不存在，此处不补。抓取日期统一为 2026-08-27。
>
> Fact-check 一节是核查阶段的结果：verdict 为 corrected 或 refuted 的条目推翻或修正了同一份里的原始值，以那一节为准。其中三条关于硅基流动单价的修正本身是错的，见 [README](./README.md)。
>
> 维度：international-and-quality。题目：国际 TTS 厂商，以及可引用的中文质量基准。

---

## Headline

国际厂商里只有 Azure 值得上测试台，而且它不便宜——同口径 ¥0.038/min 是 SiliconFlow ¥0.030/min 的 1.27 倍（Azure 明文规定每个中文字符按两个字符计费，这一条抵消了它看起来的价格优势）。它值得的地方在质量：CN-NewsTTS Bench v0.1（arXiv:2606.24714，唯一对口的中文 TTS 基准）里 Azure 排第 2（strict .756，992 个目标 750 对 0 错），而用户在跑的 CosyVoice 系列排第 5（Aliyun cosyvoice-v3-plus .472）。榜首是火山 seed-tts-2.0-standard .879。ElevenLabs/Cartesia/Deepgram/Rime/Hume/OpenAI/Google 全部出局：三家根本不支持普通话，两家中国封锁，剩下的贵 2-6 倍且没有任何中文质量证据。最后一条比换厂商更值钱：这个基准考的是「数字/型号/单位/缩写从裸文本念对没有」，而用户的管线上游本来就有 LLM 在生成简报文本——让它直接吐「九十六比九十一」而不是「96-91」，能绕开整个失分轴，成本为零。

## Candidates

### Microsoft Azure（中国区，世纪互联/蓝云运营，region chinanorth3）

- **模型 ID**：Neural TTS 标准音色，zh-CN-XiaoxiaoNeural / zh-CN-YunxiNeural / zh-CN-YunjianNeural / zh-CN-XiaoyiNeural 等，均 GA。DragonHD / DragonHDFlash 在中国区本地化文档里标 ❌（与全球文档矛盾，见 openQuestions）。
- **原始价格**：¥95.4 / 100 万计费字符（神经网络文本转语音）。承诺层：80M 字符/月 ¥6,105.6，折合 ¥76.32/百万。
- **¥/min 折算**：¥0.038/min。算式：Azure 文档明确「Each Chinese character is counted as two characters for billing」，故 199 汉字/分钟 × 2 = 398 计费字符；398 × ¥95.4 ÷ 1,000,000 = ¥0.0380。同口径下 SiliconFlow 为 199 汉字 × 3 字节 = 597 字节；0.597 × ¥0.05 = ¥0.0299/min。即 Azure ≈ SiliconFlow 的 1.27 倍。（用户自报的 ¥0.039/min 含标点和拉丁字符，口径更宽；两边都放宽后 Azure 约 ¥0.050 对 SiliconFlow ¥0.039。）3 分钟/天全年 1,095 分钟 = ¥41.6/年。
- **免费额度**：F0 免费层 50 万计费字符/月 = 25 万汉字 = 每月约 1,256 分钟普通话；按月刷新，不是一次性试用。3 分钟/天的简报每月约 1.8 万汉字（3.6 万计费字符），只占免费额度的 7%，10 分钟/天也只占 24%——这个用例实际可以长期 ¥0。代价：F0 实时 TTS 限 20 次请求 / 60 秒且明文不可调，按句接力如果句子偏短（每句 < 3 秒）会撞限，需要 S0。
- **流式形态**：text-in 不可流式：一次一个 SSML 请求，整句进。audio-out 增量：全部 raw-* 格式列在文档的 Streaming 分组下，且「This file can be played as it's transferred」。未公布 chunk 大小，也未公布首帧携带多少音频——criterion 1（首帧 < 0.4 句）只能自己测，不能从文档推断。
- **输出格式**：原始 PCM，采样率可选：raw-16khz-16bit-mono-pcm / raw-22050hz / raw-24khz / raw-44100hz / raw-48khz。零解码步骤，直喂 AVAudioPlayerNode，且能对齐 VPIO 的采样率。这是 docs/33 架构想要的形态。
- **协议与工作量**：OpenAI 不兼容，但比它还简单：单个 POST /cognitiveservices/v1，body 是 SSML，两个 header（Ocp-Apim-Subscription-Key、X-Microsoft-OutputFormat）。Rust 侧几十行，本轮所有候选里最少的工作量。没有 WebSocket 会话协议，没有事件状态机。
- **延迟说法**：厂商声称标准 neural 与 HD 均 < 300 ms（Azure OpenAI 音色 > 500 ms）。这是 Azure 自己的文档数字，没有第三方复现；前一轮已确认业界不存在可复现的 TTS TTFB 第三方基准，不要当事实用。
- **质量证据**：CN-NewsTTS Bench v0.1（arXiv:2606.24714，2026-06）第 2 名 / 共 7 家：strict accuracy .756，95% CI [.728,.782]，coverage .756，resolved accuracy 1.000（992 个目标中 correct 750 / wrong 0 / unknown 242）。0 个错读是全场唯一——ASR 能判定的地方 Azure 从没念错，.756 的缺口全部来自 ASR 无法判定。测试配置正是 zh-CN-XiaoxiaoNeural，中国区也有这个音色，所以分数直接适用。
- **音色**：中国区提供标准 zh-CN 神经音色若干（Xiaoxiao、Yunxi、Yunjian、Xiaoyi、Yunyang、Yunxia、Hezhi 等）。适合陪读伙伴而非新闻主播的：zh-CN-YunxiNeural 带 StyleList chat / assistant / narration-relaxed / cheerful / serious，另有 RolePlayList Narrator / YoungAdultMale / Boy。viseme：中国区文档确认 zh-CN 支持「视素 ID」和「混合形状」两种输出，为以后宠物口型动画留了路（SVG 仅 en-US）。
- **境内可达**：中国区由世纪互联/蓝云独立运营，域内合规、人民币计费、理论上不需要代理。但注册资质未能证实：azure.cn 的 purchase-options 与 subscription-agreement 页面均 404，条款只提供 PDF 下载。历史上 Azure 中国要求企业营业证照与企业实名，个人开发者大概率开不了户——这是这条路最可能的拦路条件，必须先去问蓝云（contactus@oe.21vianet.com / 400-089-0365）再谈别的。
- **本维度结论**：值得上测试台，而且应该排第一个测。理由不是便宜（它贵 27%），是在唯一对口的中文基准上比现役方案高 .284 的 strict accuracy，同时协议最简单、输出格式最合架构、免费额度覆盖整个用例、还顺带解决了以后口型动画的取数问题。前置条件是先确认个人能不能开户——这一条不成立的话整行作废，退到全球区。
- **Source**：https://www.azure.cn/pricing/details/cognitive-services/ ; https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech ; https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech#billable-characters ; https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits ; https://docs.azure.cn/zh-cn/ai-services/speech-service/language-support

### Microsoft Azure（全球区，建议 East Asia / Japan East / Korea Central）

- **模型 ID**：Neural TTS 标准音色（zh-CN-XiaoxiaoNeural 等，GA）；另有 14 个 zh-CN DragonHD Flash 音色 GA：zh-CN-Xiaoxiao/Xiaoxiao2/Xiaochen/Xiaoyi/Xiaoyu/Xiaohan/Xiaoshuang/Xiaoyou/Yunxi/Yunyi/Yunxiao/Yunhan/Yunxia/Yunye:DragonHDFlashLatestNeural。另有 DragonHDOmni（700+ 音色）。
- **原始价格**：S1/S0 Neural Text To Speech：$15.00 / 100 万字符（Azure Retail Prices API 实取，meterName 'S1 Neural Text To Speech Characters'）。承诺层溢出价降到 $11.4（80M）/ $6.0（4000M）/百万。Custom Neural 实时 $24/百万，CNV Neural HD $48/百万。
- **¥/min 折算**：¥0.040/min。算式：中文字符 ×2 计费，199 × 2 = 398 计费字符；398 × $15 ÷ 1,000,000 = $0.005970/min；× 6.7378（USD/CNY，2026-08-27 实取）= ¥0.0402/min。约为 SiliconFlow 同口径 ¥0.0299 的 1.34 倍。3 分钟/天全年 = ¥44/年。
- **免费额度**：F0 免费层 50 万计费字符/月，按月刷新（与中国区同）。同样受 20 次请求/60 秒的不可调限制。
- **流式形态**：与中国区同：text-in 整句不可流式；audio-out 增量，raw-* 在 Streaming 分组，chunk 大小与首帧占比均未公布。DragonHD Omni 额外提供 word boundary 事件（词级时间戳），对做逐词高亮有用。
- **输出格式**：原始 PCM，raw-16khz / 22050hz / 24khz / 44100hz / 48khz-16bit-mono-pcm 可选。HD 音色同样支持 pcm，采样率 8/16/24/48 kHz。
- **协议与工作量**：同中国区：单 POST + SSML body + 两个 header。区别只是 endpoint 换成 https://<region>.tts.speech.microsoft.com/cognitiveservices/v1（东亚为 eastasia）。
- **延迟说法**：厂商声称：标准 neural < 300 ms，DragonHD < 300 ms，Azure OpenAI 音色 > 500 ms。仅厂商数字。注意从大陆到 East Asia（香港）网络 RTT 约 40-80 ms，要计进 criterion 3 的 500 ms 预算；相比之下 ElevenLabs/Cartesia 这类美国托管的光 RTT 就吃掉 180-250 ms。
- **质量证据**：同上，CN-NewsTTS Bench v0.1 第 2 名 strict .756 / 0 错读。补充：HD 音色未被该基准测过，分数不能外推到 DragonHDFlash。另有 enhancePronunciation 参数（HD 专用）专门优化缩写、专有名词、多音词——正对着这个基准的失分轴，但基准明确禁用「user-side rules」，所以它的收益没有被测过。
- **音色**：全球区能拿到 14 个 zh-CN HD Flash 音色，风格表直接对着「陪读伙伴而不是新闻主播」这个需求：zh-CN-Xiaoyi 有 cute / gentle / shy / nervous；zh-CN-Xiaoyou 有 chat / cheerful / story / cute；zh-CN-Xiaoxiao2 有 affectionate / empathetic / encouraging / curious / whispering；zh-CN-Yunxi 有 chat / voice-assistant / news；zh-CN-Yunyi 是游戏角色向（assassin / captain / prince / game-narrator / poet）。代价：HD 音色不支持 <mstts:viseme> 也不支持 <prosody>，口型动画和 HD 音色二选一。
- **境内可达**：未测，且我无法测：本机全部出口流量走洛杉矶（绕过 proxy 环境变量后 egress IP 仍是 45.78.7.144 / Los Angeles / IT7 Networks），任何我在这里跑的连通性数字都是隧道的数字不是中国的数字。已知事实只有：微软域名不在 GFW 封锁名单上，Azure 全球区被大量中国公司使用；跨境链路高峰期抖动是常态。付款需要国际信用卡（Visa/Mastercard），中国双币卡通常可用但需自证。
- **本维度结论**：中国区开不了户时的退路，而且音色阵容其实更好。贵 34%，但拿到 14 个带 cute/gentle/chat/story 风格的 zh-CN HD Flash 音色，这是所有候选里唯一直接回答「陪读角色音色」的。测的时候必须用 East Asia 或 Japan East endpoint，别用美国区——RTT 会直接吃掉 criterion 3 的预算。
- **Source**：https://prices.azure.com/api/retail/prices?$filter=contains(productName,'Speech') ; https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices ; https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech

### ElevenLabs

- **模型 ID**：Flash v2.5（GA，32 语言含中文）；Multilingual v2（GA，29 语言）；Eleven v3 与 v3 Conversational（GA，70+ 语言含 cmn）。Turbo v2/v2.5 已弃用。
- **原始价格**：API 价目页：Flash/Turbo $0.05 / 1K 字符；v3 Conversational $0.05 / 1K；v3 与 v2 Multilingual $0.10 / 1K。
- **¥/min 折算**：¥0.067/min（Flash v2.5）。算式：$0.05/1K = $50/百万字符；假设中文按 1 字符计（文档 404，未证实）199 × $50 ÷ 1,000,000 = $0.00995/min × 6.7378 = ¥0.0670。约为 SiliconFlow 的 2.24 倍。v3 则是 ¥0.134/min，4.5 倍。若中文实际按 2 字符计，Flash 要翻倍到 ¥0.134/min。3 分钟/天全年 ¥73/年。
- **免费额度**：有免费层但配额未在 API 价目页写明。
- **流式形态**：支持 HTTP chunked streaming 与 WebSocket（含 multi-context）。chunk 大小与首帧占比均未公布。text-in 可通过 WebSocket 增量输入。
- **输出格式**：PCM (S16LE) 16 / 22.05 / 24 / 44.1 / 48 kHz，另有 MP3、μ-law、A-law、Opus。文档注明「Higher quality audio options are only available on paid tiers」，PCM 是否属于受限项未写明。
- **协议与工作量**：自有 REST + WebSocket，非 OpenAI 兼容。REST 单请求拿 PCM 的路径不复杂，Rust 侧工作量接近 Azure；要用 multi-context WebSocket 则显著变重。
- **延迟说法**：Flash v2.5 「~75 ms」，v3 Conversational 「~280 ms」，均标注 excluding network latency，且带脚注免责。纯厂商数字，且刨掉了网络——从中国大陆到其美国/欧洲推理节点的 RTT 会是这个数字的 2-3 倍，criterion 3 的 500 ms 预算很紧。
- **质量证据**：没有。未进入 CN-NewsTTS Bench 的 7 家。TTS Arena V2 明文「Prompts are English-only for now」。Artificial Analysis 的 Elo 也是英文偏好分。ElevenLabs 是英文优先厂商，中文在数字/型号/单位上的表现没有任何公开数据支撑，只有厂商自称支持 32 语言。
- **音色**：库很大（Voice Library 数千个），但中文音色主要是多语言模型跨语种发音，不是中文原生录制，做陪读角色的音色一致性存疑。
- **境内可达**：未测（本机出口在洛杉矶，测不了）。域名不在已知封锁名单，但推理节点在境外，RTT 是结构性劣势。付款需要国际信用卡，无人民币通道。
- **本维度结论**：只在 Azure 两条路都走不通时才测。贵 2.24 倍，中文质量零证据，推理节点在境外。它唯一的优势是 75 ms 的声称延迟和成熟的 PCM 流式接口——但那个 75 ms 刨掉了网络，而网络恰好是从中国用它最贵的一段。排第三。
- **Source**：https://elevenlabs.io/pricing/api ; https://elevenlabs.io/docs/models ; https://elevenlabs.io/docs/capabilities/text-to-speech

### Cartesia

- **模型 ID**：Sonic-3.6（价目页只列这一个当前版本）。支持 49 种语言，含 zh。
- **原始价格**：按套餐分钟数计，不公布单字符价：Free $0/月约 27 分钟；Pro $5/月约 133 分钟；Startup $49/月约 1,667 分钟；Scale $299/月约 10,667 分钟。
- **¥/min 折算**：¥0.189/min（Scale 档，最优）。算式：$299 ÷ 10,667 min = $0.02803/min × 6.7378 = ¥0.1889。Startup 档 $49 ÷ 1,667 = $0.0294/min = ¥0.198/min；Pro 档 $5 ÷ 133 = $0.0376/min = ¥0.253/min。约为 SiliconFlow 的 6.3-8.5 倍。更糟的是它按套餐买断分钟数，3 分钟/天只用 90 分钟/月，买 Pro 档要浪费 32% 的额度，实际单价还要更高。
- **免费额度**：Free 档 $0/月约 27 分钟，按月。3 分钟/天需要 90 分钟/月，免费额度不够。
- **流式形态**：WebSocket（wss://api.cartesia.ai/tts/websocket），audio-out 增量。chunk 大小与首帧占比文档未公布（详细 API 页需登录）。支持 continuations 做增量文本输入。
- **输出格式**：只有原始 PCM 容器：pcm_f32le / pcm_s16le / pcm_mulaw / pcm_alaw。采样率 8000 / 16000 / 22050 / 24000 / 44100 / 48000 Hz 可选。无 MP3。这是本轮技术形态上最贴合 AVAudioPlayerNode 的一家。
- **协议与工作量**：WebSocket 会话协议，非 OpenAI 兼容。比 Azure 的单 POST 重一个量级，正是任务书里点名要警惕的那种工作量。
- **延迟说法**：价目页无延迟数字。Artificial Analysis 的「Speed」指标是生成整段音频的中位时间（含下载），不是首包时间——不能拿来判 criterion 3。
- **质量证据**：Artificial Analysis Speech Arena 质量 Elo 1,285，全场最高。但这个分数对本用例无效：Artificial Analysis 的方法论页未声明多语种，同类 TTS Arena V2 明文英文-only，其 Elo 是英文人类偏好分。Sonic 未进 CN-NewsTTS Bench。中文质量证据为零。
- **音色**：49 语言的多语种模型，zh 只是其中之一，无中文原生音色阵容说明。
- **境内可达**：未测（本机出口在洛杉矶）。美国托管，无中国节点，RTT 是结构性劣势。付款需国际信用卡。
- **本维度结论**：不值得测。技术形态最漂亮（纯 PCM、8 档采样率、WebSocket 增量），但贵 6-8 倍、按分钟套餐买断对 3 分钟/天极不划算、协议工作量重一个量级，而且那个全场最高的 Elo 1285 是英文分，对「念中文科技新闻」一点信息量都没有。除非前三家全废，否则跳过。
- **Source**：https://cartesia.ai/pricing ; https://docs.cartesia.ai/api-reference/tts/tts ; https://artificialanalysis.ai/text-to-speech ; https://artificialanalysis.ai/text-to-speech/methodology

## Ruled out

- Deepgram（Aura-1 / Aura-2 / Flux TTS）——不支持普通话。官方文档列出的 Aura-2 语言只有 en/es/de/fr/nl/it/ja，明确没有 zh。价格 $0.030/1K 字符（约 ¥0.040/min）本来有竞争力，但语言这一条是硬否决。失败判据：中文可用性。
- Rime（Mist v3 / Coda）——不支持普通话。Coda 生产可用语言为 English/Arabic/French/German/Hindi/Japanese/Portuguese/Spanish，Mist v3 更少（en/fr/de/es）。$0.03/1K（约 ¥0.040/min）且送 3,000 分钟，可惜没中文。失败判据：中文可用性。
- Hume（Octave 1 / Octave 2 preview）——不支持普通话。Octave 1 只有 en/es；Octave 2 preview 有 11 种语言（en/ja/ko/es/fr/pt/it/de/ru/hi/ar），仍无 zh。且 $0.05-0.15/1K 是本轮最贵档之一（¥0.067-0.202/min）。失败判据：中文可用性。
- OpenAI（gpt-4o-mini-tts / tts-1 / tts-1-hd / gpt-realtime）——中国大陆封锁且不接受中国支付方式。价格上也不占优：gpt-4o-mini-tts 音频输出 $12/百万，按厂商自估 ~$0.015/min = ¥0.101/min，是 SiliconFlow 的 3.4 倍；tts-1 $15/百万字符、tts-1-hd $30/百万。另外只出 MP3/Opus/AAC/FLAC/WAV/PCM 里的编码格式，且未进任何中文基准。失败判据：中国可达性 + 付款。
- Google Cloud TTS（Chirp 3 HD，cmn-CN-Chirp3-HD-Kore）——中国大陆封锁，无代理不可达，且无人民币付款通道。质量上也只是中游：CN-NewsTTS Bench 第 3 名 strict .604，coverage .861，resolved .701（correct 599 / wrong 255 / unknown 138）——255 个错读是 Azure 的无穷倍。价格页数字在抓取时未渲染（多次尝试均为占位符），按历史 $30/百万字符估算约 ¥0.040/min，未证实。失败判据：中国可达性。
- AWS Polly（polly-neural，Zhiyu 音色）——CN-NewsTTS Bench 全场倒数第一：strict accuracy .244，95% CI [.218,.272]，coverage .570，resolved .428（correct 242 / wrong 323 / unknown 427）。念错的比念对的还多。虽然 AWS 中国（宁夏/北京，光环新网/西云数据）在境内合规运营且价格最低（约 ¥0.022/min），但要 ICP 备案的企业账户，而且 .244 的正确率对「念满是型号和百分比的科技简报」这个用例是灾难性的。失败判据：质量。
- PlayHT / PlayAI——无法确认服务仍在运营。docs.play.ai 返回证书过期（certificate has expired），play.ht 主页抓取 socket 关闭。在无法确认 API 是否还活着、价格和中文支持都取不到的情况下，不能列为候选。失败判据：厂商存续性未证实。
- 小米 MiMo（mimo-v2.5-tts）——用户已按首包 1100-1900 ms 判出局，基准数据进一步坐实：CN-NewsTTS Bench 第 6 名 strict .275，coverage .628，resolved .438（correct 273 / wrong 350 / unknown 369），念错的比念对的多。免费也不值得。失败判据：criterion 3（延迟）+ 质量，双杀。
- TTS Arena V2 作为选型依据——排除的是「证据」不是厂商。官方文档明文「Prompts are English-only for now, capped at 1,000 characters」，对普通话零覆盖，任何引用它的中文排名都是错的。
- Artificial Analysis Speech Arena 作为延迟依据——其 Speed 指标定义为「生成单段音频的中位时间，含从提供方下载」，是整段生成时间不是首包时间，不能用于判 criterion 1 或 3；其质量 Elo 走 LMSYS 式线性回归，方法论页未声明任何多语种覆盖。

## Open questions

- Azure 中国（世纪互联/蓝云）个人开发者能不能开户？这一条决定中国区那一行成不成立。azure.cn 的 purchase-options、subscription-agreement、enterprise-agreement 页面在 2026-08-27 全部 404，服务条款只提供 PDF 下载，我拿不到条款正文。历史惯例是要企业营业执照 + 企业实名。建议直接问蓝云：contactus@oe.21vianet.com / 400-089-0365。开不了就走全球区 East Asia。
- Azure 全球区从中国大陆裸网的可达性和 RTT 是多少？我测不了，也不该假装能测：本机即使绕过 proxy 环境变量，出口 IP 仍是 45.78.7.144（Los Angeles / IT7 Networks），我跑的任何连通性数字都是隧道的数字。必须在 iPad 真机的真实网络上测 eastasia.tts.speech.microsoft.com。
- 顺带一个前提要澄清：用户先前对三家的实测标注是「same tunnel」。如果开发机常态走隧道，那 SiliconFlow 的 317.7 ms 也是隧道下的数字，而 TestFlight 上架后终端用户是裸网——「能否直连」的判据到底按哪个环境定，需要先说清楚，否则这一轮所有厂商的可达性结论都悬空。
- zh-CN 的 DragonHD Flash 音色在中国区到底有没有？全球文档明写「available in standard Azure regions (eastus, westeurope, southeastasia) as well as China regions (chinanorth3)」，但 docs.azure.cn 的本地化语言支持页把 DragonHD / DragonHDFlash 全标 ❌。两份微软自己的文档打架。保守假设中国区只有标准 neural 音色（好消息是 .756 那个分数正是标准 zh-CN-XiaoxiaoNeural 测出来的，直接适用）。
- Azure 的首帧携带多少音频？文档只把 raw-* 列在 Streaming 分组下并说「can be played as it's transferred」，从不公布 chunk 大小。criterion 1（首帧 < 0.4 句）对 Azure 完全是未知数，只能拿用户现成的 40 句测试台实测。这是上测试台要回答的第一个问题。
- ElevenLabs 对中文字符按 1 还是 2 计费？其 billing 文档页 404，取不到规则。按 1 算是 ¥0.067/min，按 2 算是 ¥0.134/min——差一倍，会把它从「第三顺位」推到「不必测」。
- SiliconFlow CosyVoice2-0.5B 自己在 CN-NewsTTS Bench 上是多少分？没人测过。基准里的 .472 是 Aliyun 的 cosyvoice-v3-plus（longanyang 音色），和 SiliconFlow 托管的 CosyVoice2-0.5B 开放权重是同族不同物，把 .472 直接安到现役方案头上是推断不是测量。好消息：基准完全开源（github.com/Jayden-X-L/cn-news-tts-bench，v0.1 tag），800 条公开记录 992 个可自动判定目标，评分器可离线跑，只要把音频喂进去或提供 JSONL 格式的 ASR 结果即可。自测一遍就能把这个推断变成数字，而且顺手能把 Azure 一起测了。
- CN-NewsTTS Bench 本身要打折看：单作者（Shijun Luo）2026-06 的 v0.1 预印本，全自动评测，无厂商回应或配置确认（论文没有 vendor-contact 章节），评测窗口只有 2026-06-20 到 06-23 四天。它自己的 Limitations 写明「should not replace human listening tests. ASR text can hide pronunciation errors, especially same-character tones」。当方向性证据用，别当判决书。
- 它测的轴要看准：只测「裸文本输入下，数字/比分/型号/单位/缩写/年份区间念对没有」，明确不测自然度、MOS、韵律。对念科技简报这正是要的轴——但也意味着「哪家声音更好听」这个问题，2026 年在普通话上依然没有任何可引用的公开证据。
- 最高杠杆的动作可能根本不是换厂商：基准的失分集中在 Sports .233、Unit .342、Brand .422、Military .440、Generation .509，而科技简报密集命中 Unit / Brand / Abbreviation / Range。基准之所以禁用「LLM rewriting、SSML hints」是因为它在考产品的裸输入行为——但用户的管线上游本来就有 LLM 在生成简报文本，让它直接输出「九十六比九十一」「六百二十牛米」而不是「96-91」「620N·m」，能绕开整个失分轴，成本为零，且对任何厂商都生效。建议在换厂商之前先做这个。
- Azure 计费还有个坑要算进预算：计费字符包含标点、空格、以及 <speak> 和 <voice> 之外的全部 SSML 标记。也就是说用 <prosody>、<break>、<say-as> 调优会按标记字符收钱。SSML 要保持最小，或者把这部分成本算进模型。

## Fact-check

### [CORRECTED] SiliconFlow comparison baseline used in Candidates 1 & 2: 199 汉字 × 3 bytes = 597 bytes; 0.597 × ¥0.05 = ¥0.0299/min (implying a price of ¥0.05 per 1,000 bytes), used to claim Azure China ≈1.27× and Azure Global ≈1.34× SiliconFlow's price

- **Correction**：Correct SiliconFlow price: 597 bytes/min × ¥0.05 / 1,000,000 = ¥0.0000299/min (≈¥0.00003/min), not ¥0.0299/min — a 1,000× error. At the correct rate, Azure China (¥0.038/min) is roughly 1,270× SiliconFlow's price, not 1.27×; Azure Global (¥0.040/min) is roughly 1,340× SiliconFlow's price, not 1.34×. All 'Azure ≈ N× SiliconFlow' comparison sentences in Candidates 1 and 2 should be discarded — SiliconFlow's TTS is effectively negligible-cost by comparison, not merely somewhat cheaper. Source: https://siliconflow.cn/pricing (raw page JSON, field priceUnit="/ M UTF-8 bytes", price="¥ 0.05")
- **Evidence**：Fetched siliconflow.cn/pricing raw page data directly. The pricing UI shows 'FunAudioLLM/CosyVoice2-0.5B ... ¥ 0.05' and the underlying JSON explicitly sets priceUnit ':"/ M UTF-8 bytes"' — i.e. ¥0.05 per ONE MILLION UTF-8 bytes, not per 1,000 bytes. This is exactly the 'per-1000 vs per-million' unit misread the task flagged as a risk.

### [UNVERIFIABLE] Candidate 2: committed-tier overage prices of $11.4/M (80M/month) and $6.0/M (4000M/month)

- **Evidence**：The azure.microsoft.com pricing page renders these figures via client-side JavaScript; the fetch tool returned only '$-' placeholders, and the Azure Retail Prices API returned an empty Items array for the TTS meter filters tried. Could not confirm or refute against a primary source within this session's tool access.

### [UNVERIFIABLE] Candidate 3: TTS Arena V2 states prompts are 'English-only for now', supporting the claim that ElevenLabs/AA Elo scores are English-preference scores

- **Evidence**：Could not locate this exact statement via the fetchable HuggingFace Space page or Artificial Analysis's methodology page in this session (JS-rendered content not captured by the fetch tool); found no evidence contradicting it either.

### [CONFIRMED] Candidate 1 (Azure China): raw price ¥95.4 per 1,000,000 billable characters for Neural TTS standard voices; F0 free tier is 500,000 characters/month

- **Evidence**：azure.cn pricing page (fetched 2026-08-27) states '每 100 万个字符 ¥95.4' for standard neural TTS and '每月 50 万个字符免费' for F0. URL: https://www.azure.cn/pricing/details/cognitive-services/

### [CONFIRMED] Candidate 1: committed-tier price at 80M chars/month = ¥6,105.6/month (≈¥76.32/M)

- **Evidence**：Same azure.cn pricing page lists 80M commitment at ¥6,105.6/month (¥76.32/M overage), matching exactly. https://www.azure.cn/pricing/details/cognitive-services/

### [CONFIRMED] Candidate 1: 'Each Chinese character is counted as two characters for billing' → 199 汉字/分钟 becomes 398 billable characters, giving ¥0.038/min

- **Evidence**：Microsoft Learn text-to-speech doc, exact quote: 'Important: Each Chinese character is counted as two characters for billing, including kanji used in Japanese, hanja used in Korean, or hanzi used in other languages.' Recomputed: 398 × ¥95.4 / 1,000,000 = ¥0.037949/min ≈ ¥0.038/min, matches claim. https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech#billable-characters

### [CONFIRMED] Candidate 1: F0 free tier renews monthly (not a one-off trial), and the F0 real-time TTS limit is 20 transactions per 60 seconds, not adjustable

- **Evidence**：Azure Learn quotas page, exact table row: 'Maximum number of transactions per time period for standard voices... Free (F0): 20 transactions per 60 seconds — This limit isn't adjustable.' Free tier is described as a per-month allowance ('50万个字符免费'/month), i.e. a renewing quota, not a one-time trial. https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits

### [CONFIRMED] Candidate 1: DragonHD/DragonHDFlash zh-CN voices are marked ❌ (unavailable) in the Azure China (docs.azure.cn) language-support documentation, contradicting global docs

- **Evidence**：docs.azure.cn language-support page shows ❌ for zh-cn DragonHD/DragonHDFlash entries (e.g. 'zh-cn-Xiaoxiao:DragonHDFlashLatestNeural' → ❌). https://docs.azure.cn/zh-cn/ai-services/speech-service/language-support?tabs=tts

### [CONFIRMED] Candidate 2 (Azure Global): raw price $15.00 per 1,000,000 characters for Standard (S0/S1) Neural TTS

- **Evidence**：Microsoft Learn quotas-and-limits page, in the TPS cost-estimation worked example, explicitly states: 'Multiply the result by the unit price of $15 per million characters to estimate the monthly cost.' This is the official primary-source dollar figure (the raw azure.microsoft.com pricing page itself renders pricing via client-side JS that this fetch tool could not extract, but the $15/M figure is independently stated on this companion Learn page). https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits

### [CONFIRMED] Candidate 2: ¥/min ≈ ¥0.0402 using 398 billable chars/min × $15/M × 6.7378 CNY/USD

- **Evidence**：Recomputed: 398 × $15 / 1,000,000 = $0.00597/min. Live USD/CNY mid-market rate at fetch time (2026-08-27 08:08 UTC) was 6.72033, vs the claimed 6.7378 — only 0.26% stale, well under the 15% flag threshold. $0.00597 × 6.7203 = ¥0.0401/min ≈ claimed ¥0.0402/min. https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=CNY

### [CONFIRMED] Candidates 1 & 2: quality evidence — Azure (tested as zh-CN-XiaoxiaoNeural) placed 2nd of 7 systems on CN-NewsTTS Bench v0.1 (arXiv:2606.24714, June 2026), strict accuracy .756, 95% CI [.728,.782], coverage .756, resolved accuracy 1.000, and 750 correct / 0 wrong / 242 unknown of 992 targets — the only system with zero majority-voted wrong readings

- **Evidence**：Downloaded and read the actual PDF (arXiv:2606.24714, 'CN-NewsTTS Bench', Shijun Luo, NetEase Cloud Music, submitted 2026-06-23). Table 5 lists exactly: Azure — Strict .756, 95% CI [.728,.782], Cov .756, Res 1.000, C/W/U 750/0/242. Rank order by strict accuracy: Volcano .879 (1st), Azure .756 (2nd), Google .604, MiniMax .548, Aliyun .472, MiMo .275, AWS .244 — confirming Azure is 2nd of 7 and the only system with Wrong=0. Table 8 confirms the tested voice/config was 'zh-CN-XiaoxiaoNeural'. All numbers in the candidate write-up match the paper exactly.

### [CONFIRMED] Candidate 3 (ElevenLabs): Flash v2.5/Turbo priced at $0.05 per 1,000 characters; Eleven v3 and Multilingual v2 priced at $0.10 per 1,000 characters

- **Evidence**：elevenlabs.io/pricing/api (fetched 2026-08-27) shows exactly '$0.05' per 1,000 characters for Flash/Turbo and '$0.10' per 1,000 characters for v3 and v2 Multilingual. https://elevenlabs.io/pricing/api

### [CONFIRMED] Candidate 3: ¥/min ≈ ¥0.0670 for Flash v2.5 (assuming 1 Chinese character = 1 billed character, explicitly flagged by the candidate as unconfirmed) and ¥0.134 for v3

- **Evidence**：Math checks out under the stated assumption: 199 × $50/M = $0.00995/min × 6.7378 (or 6.7203 live rate) ≈ ¥0.067/min; doubling for v3's $0.10/1K gives ≈¥0.134/min. However, whether ElevenLabs actually bills CJK text as 1 char/hanzi (vs. some byte-based or multiplier scheme) could not be confirmed from elevenlabs.io/docs/models or the character-usage doc (404) — the candidate's own hedge ('文档404，未证实') is accurate and should remain a caveat, not be treated as settled.

### [CONFIRMED] Candidate 3: ElevenLabs is absent from CN-NewsTTS Bench's 7 evaluated systems

- **Evidence**：arXiv:2606.24714 Table 5/8 lists only Volcano/Doubao, Azure, Google, MiniMax, Aliyun, MiMo, AWS Polly — no ElevenLabs.

### [CONFIRMED] Candidate 4 (Cartesia): Free $0/~27min, Pro $5/~133min, Startup $49/~1,667min, Scale $299/~10,667min

- **Evidence**：cartesia.ai/pricing (fetched 2026-08-27) lists exactly these four plans with these prices and minute allowances. https://cartesia.ai/pricing

### [CONFIRMED] Candidate 4: ¥/min of ¥0.189 (Scale), ¥0.198 (Startup), ¥0.253 (Pro)

- **Evidence**：Recomputed from confirmed plan prices: $299/10667=$0.02803/min, $49/1667=$0.02940/min, $5/133=$0.03759/min; × 6.7378 (or 6.7203 live) ≈ ¥0.189, ¥0.198, ¥0.253 respectively — all match the candidate's figures within rounding.

### [CONFIRMED] Candidate 4: Cartesia Sonic (3.6) has the highest Quality Elo (1,285) on Artificial Analysis's TTS leaderboard, but this score is not evidence of Chinese-language quality

- **Evidence**：artificialanalysis.ai/text-to-speech (fetched 2026-08-27): 'Sonic 3.6 currently has the highest quality in the Artificial Analysis Text to Speech models comparison, with a Quality Elo of 1,285.' Sonic/Cartesia is absent from CN-NewsTTS Bench's 7 systems, and the AA methodology page did not state Chinese-language coverage — so the candidate's caveat that this Elo doesn't demonstrate Chinese quality stands unrefuted (could not positively confirm English-only either).

