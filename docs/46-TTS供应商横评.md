# TTS 供应商横评

> 本文留一轮 TTS 供应商横评的结果：候选清单、价格口径、能引用的中文质量证据，以及接下来值得花时间测什么。上游是 [33](./33-语音简报.md)。三份维度调研和排名稿留档在 [assets/tts-vendor-survey/](./assets/tts-vendor-survey/)。共识日期 2026-08-27。
>
> 这份横评的最终推荐（留在硅基流动）作废。派研究的时候音质那一轮还没出结果，它的输入里硅基流动仍然是「三条硬标准全过的现状」，它不知道实测出来是 16 kHz 上采样冒充 24 kHz、31 句里 11 句随机内容损坏。所以本文不是一份仍然有效的选型建议，选型结论以 [33](./33-语音简报.md) 为准；这里留下的是它仍然成立的那三样。

---

## 价格口径

三份调研在这一条上互相矛盾过，而整张表都挂在它上面。

硅基流动定价页的原始数据是 `{"price":"50","specification":"utf8_bytes","unitOfGood":"/ M UTF-8 bytes"}`，页面显示「¥0.05 / 千字符 UTF-8」。两个数只有在单位是字节时才自洽（50/百万 = 0.05/千），API 文档也写明「按照输入文本长度对应的 UTF-8 字节数进行计费」。正确口径是 ¥0.05 / 1000 UTF-8 字节。按「字符」理解会把成本算便宜 3 倍。

各家口径共有三种，互差 1.5–3 倍：按字符（火山、腾讯、讯飞，1 汉字 = 1 字符，标点计费）、1 汉字算 2 字符（阿里、Azure）、按 UTF-8 字节（硅基流动，1 汉字 = 3 字节）。比较之前必须先统一。

本文统一按 199 汉字/分钟、不含标点折算，年费按每天 5 分钟 × 365 = 1825 分钟。真实账单一律再加约 25–30%：各家都收标点的钱。实测语速是 193.8–197.8 汉字/分钟，所以下面所有 ¥/min 系统性偏高 2–3%，不影响厂商之间的相对排序。

## 候选表

| 厂商 / 模型 | ¥/min | ¥/年 | 流式首帧行为 | 输出格式 | Rust 协议工作量 | 中文质量证据 | 境内可达 |
|---|---|---|---|---|---|---|---|
| 硅基流动 FunAudioLLM/CosyVoice2-0.5B（现状） | 0.0299（含标点 0.039） | ¥55（含标点 ¥71） | 实测：首帧 42.7 ms 音频＝整句 0.9%；RTF 0.118；请求到首个 PCM 225 ms；端到端 p50 317.7 / p90 350.9；40/40 | raw PCM / wav / mp3 / opus / flac；8–44.1 kHz 可选（文档写默认 44100，实测省略参数时是 24000） | 已跑通，OpenAI 兼容 POST + Bearer | 零。CN-NewsTTS 没测它 | 是，TLS 0.083–0.095 s |
| 火山引擎 seed-tts-2.0-standard | 0.0597（预付 0.0557） | ¥109（预付 ¥102） | 厂商未公布 chunk 粒度。事件序列 TTSSentenceStart → 多个 TTSResponse → TTSSentenceEnd，确认是增量不是攒整句 | HTTP 路 base64 PCM（每 chunk 一次解码）；WS 路二进制 raw PCM 帧；8000–48000 七档 | HTTP 路约一小时；WS 路是自研 V3 二进制分帧，一两百行 | 第三方基准第 1，strict .879 [.857, .898] | 是，openspeech.bytedance.com |
| Microsoft Azure Neural TTS（全球区 East Asia / 中国区 chinanorth3） | 0.0401 / 0.0380 | ¥73 / ¥69，F0 免费层实际 ¥0 | raw-* 归在 Streaming 分组，「can be played as it's transferred」，chunk 大小未公布。text-in 不可流式 | raw-16k/22.05k/24k/44.1k/48k-16bit-mono-pcm，零解码 | 全场最少：单个 `POST /cognitiveservices/v1`，body 是 SSML，两个 header | 第三方基准第 2，strict .756，唯一零错读 | 中国区合规但个人能否开户未证实；全球区跨境 RTT |
| Gitee AI 模力方舟 CosyVoice3（Fun-CosyVoice3-0.5B-2512） | 未公布 | 未公布 | 上游支持双向流式，Gitee 包装层是否保留增量 flush 未验证 | 未验证。若只出 mp3 则整条路作废 | 改 base URL + model id。`/v1/audio/speech` 已验证存在（未鉴权 POST 返 401） | seed-tts-eval test-zh CER 0.71–0.81，对现役 CosyVoice2 的 1.45 | 是，TLS 0.123–0.132 s |
| 腾讯云语音合成 · 大模型音色档 | 0.0239（预付 0.0199） | ¥44（预付 ¥36） | WebSocket 增量，binary 帧原始音频 + text 帧字级时间戳；首帧粒度未公布 | pcm / mp3。采样率取决于音色：24000 官方标注「部分音色支持」，而同一页的接口要求表只写 16000/8000 | wss + 自有签名（非 TC3），中等 | 零 | 是 |
| 讯飞开放平台 超拟人语音合成 | 未公布 | 未公布 | 真双向流式，同一会话可分段多次送文本并取音频 | raw PCM 24 kHz（base64 在 payload 里，每帧一次解码） | 方式一鉴权只要 `x-api-key` 一个头，与火山 HTTP 路相当 | 零 | 是 |
| 阿里百炼 qwen3-tts-flash | 0.0318 | ¥58 | 实测：首帧固定 320.9 ms＝整句 6.6%；RTF 0.243；端到端 360.2 / 394.8；39/40 | base64 PCM in SSE，24 kHz 固定 | DashScope 事件协议（run-task / continue-task / task-finished） | 零（基准测的是 cosyvoice-v3-plus .472，不是它） | 是 |

流式首帧行为一列，只有硅基流动和阿里两行是实测；其余是厂商文档，写「未公布」的是厂商一个字都没写。

火山那个「2 万字符 / 半年」的免费试用额度无法在公开文档页核实，公开页只有通用说法「首次开启默认为试用版本…一定的免费额度」，具体数字在控制台里。

## 出局名单

- 小米 mimo-v2.5-tts — 首包 1100–1900 ms。基准 .275 佐证，念错 350 条多于念对 273 条。
- MiniMax speech-2.8-hd / turbo — 两头都输：基准 .548 对火山 .879，而「1 汉字 = 2 字符」的口径把 hd 抬到 ¥0.139/min（¥254/年）。turbo ¥0.0796/min 仍贵于火山而质量只会更低。
- AWS Polly (Zhiyu) — 基准倒数第一 .244，correct 242 / wrong 323，念错比念对多。中国区还要企业 ICP 账户。
- Google Chirp 3 HD / OpenAI TTS — 境内不可达。Google 基准 .604、255 个错读，不值得为它翻墙。
- ElevenLabs / Cartesia / Fish Audio / DeepInfra / Novita / Replicate / fal.ai — 延迟。这台机器上带隧道测到的 TLS 握手：DeepInfra 0.605–0.629 s、Novita 0.805 s、Fish 0.592 s、Replicate 0.538–0.554 s。一次握手就吃光 500 ms 预算，而这还是下界。ElevenLabs 那个「75 ms」明文刨掉了网络，而网络正是从中国用它最贵的那段。Cartesia 另有一条：按月买断分钟数，$5 档约 133 分钟不够用，下一档 $49/月买 20000 分钟用 1825 分钟。
- Deepgram / Rime / Hume — 根本不支持普通话。Aura-2 只有 en/es/de/fr/nl/it/ja，Coda 七种里没有 zh，Octave 2 preview 十一种里也没有。
- Kokoro-82M / Chatterbox / F5-TTS / Spark-TTS / MegaTTS3 / IndexTTS-2.5 / ZipVoice / GPT-SoVITS / 端侧 — 整句一次性生成，没有流式，按句接力就失去意义。端侧另有一条：每天 3 分钟一年才 18.25 小时音频、¥43–55 的账单，任何移植工作都赚不回来；要做只能是为了离线，不能是为了省钱。
- Higgs Audio V3 — 厂商自己在 H100 上量到 1079 ms 平均延迟。
- 百度智能云大模型 TTS / 华为云 SIS — 价格取不到（前端渲染 / EdgeOne 人机校验挡住），且不在任何中文基准里，两项都不可核实。
- 硅基流动 fnlp/MOSS-TTSD-v0.5 — 形态不对：双人对话/播客模型，`[S1][S2]` 切换说话人，不是单人朗读。
- 火山 bigtts 1.0（¥5/万字符）/ 豆包音频生成 1.0（¥1/分钟、不流式）/ 腾讯超自然档（¥0.129/min）/ 腾讯精品档（上一代小模型）— 分别失价格、失流式、失价格、失质量。

## CN-NewsTTS Bench v0.1

[arXiv:2606.24714](https://arxiv.org/abs/2606.24714)，网易云音乐 Shijun Luo，采样 2026-06-20~06-23，仓库 [github.com/Jayden-X-L/cn-news-tts-bench](https://github.com/Jayden-X-L/cn-news-tts-bench)。测的是「裸文本进去，数字、比分、型号、单位、缩写、年份区间念对没有」，和每日科技简报是同一件事。

| 系统 | strict accuracy | 95% CI | coverage | correct / wrong / unknown |
|---|---|---|---|---|
| 火山 seed-tts-2.0-standard | .879 | [.857, .898] | .913 | — |
| Azure zh-CN-XiaoxiaoNeural | .756 | [.728, .782] | .756 | 750 / 0 / 242 |
| Google cmn-CN-Chirp3-HD | .604 | — | .861 | 599 / 255 / 138 |
| MiniMax speech-2.8-hd | .548 | [.517, .579] | .850 | — |
| 阿里 cosyvoice-v3-plus | .472 | [.441, .503] | .533 | — |
| 小米 mimo-v2.5-tts | .275 | — | .628 | 273 / 350 / 369 |
| AWS Polly Zhiyu | .244 | [.218, .272] | .570 | 242 / 323 / 427 |

Azure 的 992 个目标里 correct 750 / wrong 0 / unknown 242，是七家里唯一的零错读。

分类失分：火山体育比分 .996、军事 .865，弱在单位符号 .573 和中外混合品牌名 .391。cosyvoice-v3-plus 单位符号 .021 几乎全错，体育比分 .134、军事 .198、品牌 .281。MiniMax 体育比分 .000（把 96-91 读成「九十六到九十一」）。

火山的这几个数经逐字复核，与论文 Table 5、Table 7 精确匹配到小数点后三位。

### 这份证据的三条限制

现役方案根本没被测过。表里的 .472 是阿里托管的 cosyvoice-v3-plus，和硅基流动托管的 CosyVoice2-0.5B 开放权重是同族不同物。把 .472 安到现役头上是推断不是测量。0.5B 更小更老，没有理由假设它更好，但这终究是推断。

没有任何基准量「好不好听」。TTS Arena V2 明文「Prompts are English-only for now」，对普通话零覆盖；Artificial Analysis 的 Elo 不发布语种分解，证据是同一家厂商内部被劈成 Qwen3 TTS Flash 940.4 对 Qwen-Audio-3.0-TTS-Plus 1237.3。2026 年在普通话自然度上没有可引用的公开证据。

没有任何第三方量首包时间。Artificial Analysis 的 Speed 指标是「生成整段音频的中位时间，含下载」。火山的 600 ms、ElevenLabs 的 75 ms、CosyVoice 的 150 ms，一个都没被第三方复现过。项目自己那 40 句测试台是唯一能量到这套架构真正依赖的那个数的仪器。

基准本身也要打折：单作者 2026-06 的 v0.1 预印本，全自动 ASR 评分，四天采样窗口，论文里没有厂商配置确认环节，它自己的 Limitations 写明「should not replace human listening tests. ASR text can hide pronunciation errors, especially same-character tones」。当方向性证据用。

## 最该做的事不在换厂商

基准的失分集中在单位符号、中外混合品牌名、体育比分、英文缩写，而科技简报密集命中的正是这几类。它之所以能测出这些，是因为规定了「裸文本进去，不许 SSML 不许 LLM 改写」——它在考产品的原始行为。

但这个项目的管线上游本来就有一个 LLM 在生成简报文本。让它直接写「六百二十牛·米」「百分之三十」「二〇二六年」而不是「620N·m」「30%」「2026」，整条失分轴当场绕开，成本为零，对任何厂商都生效。顺带解决三家共有的连字符硬伤：`苏-27` 全部被念成「苏负二十七」。

这件事先做，做完再谈换不换。

## 值得实测的三个候选

按「花多少时间才能拿到答案」排。

**阿里 qwen-audio-3.0-tts 系列。** 最省事的一步：同一个 DashScope 账号、同一把 key、同一套协议族，理论上改个 model id 就能测。价格公开写在计费页上（[help.aliyun.com/zh/model-studio/billing-for-model-studio](https://help.aliyun.com/zh/model-studio/billing-for-model-studio)，同页头部明文写 1 汉字 = 2 字符）：

| 模型 | 单价 | ¥/min（199 汉字） |
|---|---|---|
| cosyvoice-v3-plus | ¥2/万字符 | 0.0796 |
| qwen-audio-3.0-tts-plus（阿里官方首推） | ¥1.4/万字符 | 0.0557 |
| qwen-audio-3.0-tts-flash | ¥1/万字符 | 0.0398 |
| qwen3-tts-flash（已实测） | ¥0.8/万字符 | 0.0318 |

所以阿里的新一代不是更便宜而是更贵：flash 比已实测的 qwen3-tts-flash 贵 25%，plus 贵 75%。它值得测是因为工程成本接近零，不是因为价格。一个待验证点：已实测的 qwen3-tts-flash 走的是 HTTP + `X-DashScope-SSE: enable`，而 qwen-audio-3.0-tts 系列在文档里是 run-task / continue-task 的 WebSocket 协议族，HTTP 流式那条路通不通没有验证过。另外 `qwen3-tts-vc` / `qwen3-tts-vd` 没有裸模型 ID，只有带日期的快照（如 `qwen3-tts-vc-2026-01-22`），调不带日期的名字会失败；`qwen3-tts-*-realtime` 家族走的是另一套 `session.finish` / `session.finished` 协议、端点也不同，接两种模型要写两套客户端。

**火山 seed-tts-2.0-standard，走 HTTP Chunked 单向流式。** `POST /api/v3/tts/unidirectional`，鉴权只有 X-Api-Key / X-Api-Resource-Id / X-Api-Request-Id 三个明文头，没有 HMAC，没有 access token 交换，reqwest 流式读 chunk + serde_json + base64 就完了（[volcengine.com/docs/6561/1359370](https://www.volcengine.com/docs/6561/1359370)）。约一小时能接。控制台点【试用】领 2 万字符、半年有效。

它回答两个研究解决不了的问题。一是厂商自己写的「流式调用首包耗时在 600 ms 左右」是不是真的——那句话描述的是上一代 bigtts，而且同一张表里的采样率信息已经和 2.0 接口文档打架（表说单向流只有 24K/16K/8K，接口文档给到 48000），说明它至少部分过期。二是首帧携带多少音频：两条流式路的 chunk 粒度厂商一个字都没写。

判据不放宽：p90 真落在 600 ms 就照标准判死，不要因为 .879 而抬门槛。如果 HTTP 路首帧粒度太粗但延迟过关，再上 WebSocket 单向流式复测。

**Gitee AI 模力方舟的 CosyVoice3（Fun-CosyVoice3-0.5B-2512）。** 全场唯一「换过去几乎零工程成本」的质量升级：同族、同参数量、境内托管、OpenAI 兼容 `/v1/audio/speech`，改 base URL 和 model id 即可，seed-tts-eval 中文 CER 0.71–0.81 对现役 CosyVoice2 的 1.45。缺的只有价格那一个数，官网未公布。

验证只要十分钟，不用一小时：注册（要大陆手机号），打开模型页把价格和免费额度抄出来，发一句带 `response_format=pcm`。只出 mp3 或者攒整句才 flush 就当场判死，别再往下投时间。

## 不值得花时间的

- Azure — 两件事挡在前面。一是世纪互联中国区个人开发者能不能开户（azure.cn 的 purchase-options / subscription-agreement 页面 2026-08-27 全部 404，条款只给 PDF，历史惯例要企业执照）。二是 F0 免费层写死 20 次请求 / 60 秒且不可调：按句接力 5 分钟简报约 100 句，稳态每分钟 20 次请求，正好顶在天花板上——卡死的是请求频率不是字符数，免费额度按字符只用掉 12%。问蓝云（contactus@oe.21vianet.com / 400-089-0365）是十分钟的事，架测试台是一小时的事，顺序别反。
- 腾讯 — 零质量证据，一年只省 ¥11，而且流式接口的采样率在官方同一页里自相矛盾（接口要求表写死 16000/8000，SampleRate 参数表写 24000 部分音色支持），要用得先确认目标音色支不支持 24k。
- 讯飞 — 超拟人没有公开价。那份 ¥1.2–2.0/万字符 是 `xfyun.cn/services/smart-tts` 里「在线语音合成」（老一代）的价格，不是超拟人的；超拟人的产品页现在返回未能找到页面。单价只能登录控制台看。
- 阿里 qwen3-tts-flash — 已实测，首帧 320.9 ms、RTF 0.243、端到端 360.2 / 394.8，三项都比现状的实测数字差。同族的新一代见上一节。
- 所有境外厂商 — RTT 结构性出局。

## 一条限定

现有的延迟数字都是在开发机上测的，而开发机常态走隧道。对境内厂商这只会更快不会更慢，现状的余量只是被低估了；但这台机器上测到的任何境外厂商数字都只是下界，不能当结论。真要判境外，只能在 iPad 真机的真实网络上测。
