# TTS 供应商横评

> 本文留一轮 TTS 供应商横评的结果：候选清单、价格口径、能引用的中文质量证据。选型 2026-08-27 结束，定小米 `mimo-v2.5-tts`（[33](./33-语音简报.md)），本文随之从待测清单变成结案记录：谁测了、谁没测、各自为什么。上游是 [33](./33-语音简报.md)。三份维度调研和排名稿留档在 [assets/tts-vendor-survey/](./assets/tts-vendor-survey/)。共识日期 2026-08-27。
>
> 这份横评的最终推荐（留在硅基流动）作废。派研究的时候音质那一轮还没出结果，它的输入里硅基流动仍然是「三条硬标准全过的现状」，它不知道实测出来是 16 kHz 上采样冒充 24 kHz、31 句里 11 句随机内容损坏。所以本文不是一份仍然有效的选型建议，选型结论以 [33](./33-语音简报.md) 为准；这里留下的是它仍然成立的那三样。

---

## 结案状态

| 候选 | 状态 |
|---|---|
| 小米 `mimo-v2.5-tts` | 定了，见 [33](./33-语音简报.md) |
| 阿里 `qwen3-tts-flash` | 三轮实测，备选 |
| 阿里 `qwen-audio-3.0-tts-plus` / `-flash` | 实测出局 |
| 硅基流动 `FunAudioLLM/CosyVoice2-0.5B` | 实测出局：16 kHz 上采样冒充 24 kHz、31 句里 11 句随机内容损坏 |
| Azure Neural TTS | 调研出局 |
| 火山、Gitee AI CosyVoice3、腾讯、讯飞、Fish Audio | 没测，也不打算测 |

下面的候选表和价格口径按调研当时的状态留着，没有回填这张表的结论。

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

这份名单是横评当时的。小米那条后来被实测推翻：1100–1900 ms 是域名被分流到境外的账，加进直连规则重跑是 804 ms 首字；基准 .275 对应的读音错在实测里是确定性的，一张替换表消得掉（[33](./33-语音简报.md)）。其余各条仍成立。

- 小米 mimo-v2.5-tts — 首包 1100–1900 ms。基准 .275 佐证，念错 350 条多于念对 273 条。（已推翻，见上）
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

## 阿里新一代：实测出局

2026-08-27 实测五条腿（新 flash / 新 plus 各配基础播音音色 `-longliuxulan`、小米、`qwen3-tts-flash`、新 flash 配系统音色），同时段交替发送、每句新建连接、全程直连。逐项数据在 [assets/tts-probe/](./assets/tts-probe/) 的 `latency-report-2026-08-27.md`，结论在 [33](./33-语音简报.md) 的「实测」。

三条理由。配上能念简报的基础播音音色，真实首字 p50 是 flash 946 ms、plus 1209 ms，慢于小米的 804 和 `qwen3-tts-flash` 的 471；按实测计费量折算每分钟 ¥0.0486 / ¥0.0671，贵于旧模型的 ¥0.0462；播音音色的句首静音标准差 89.6 ms，用户等第一个字的时间在 570–1257 ms 之间跳（坑 188）。系统音色首字 584 ms 确实快，但那 12 个音色全是陪伴、儿童、角色向，念不了简报。音质轮没跑，延迟结果出来就叫停了。

标称单价（[help.aliyun.com/zh/model-studio/billing-for-model-studio](https://help.aliyun.com/zh/model-studio/billing-for-model-studio)，同页头部明文写 1 汉字 = 2 字符）：cosyvoice-v3-plus ¥2、qwen-audio-3.0-tts-plus ¥1.4、qwen-audio-3.0-tts-flash ¥1、qwen3-tts-flash ¥0.8，每万字符。新一代比旧模型贵 25% 和 75%，实测每分钟成本又比标称折算高两到四成。

协议那条待验证项有了答案，全文在同目录的 `qwen-audio-3-protocol-2026-08-27.md`：HTTP + `X-DashScope-SSE: enable` 通，不需要 WebSocket；端点是 `/api/v1/services/audio/tts/SpeechSynthesizer`，和 `qwen3-tts-flash` 不是同一条路径，别沿用旧的；`input.format` 支持裸 `pcm`（绕开坑 187），采样率可选；参数错误返回 HTTP 200，错误藏在 SSE 流里的一个 data 事件，只看 status code 会把它当成空音频。

同族的 `qwen3-tts-vc` / `qwen3-tts-vd` 没有裸模型 ID，只有带日期的快照（如 `qwen3-tts-vc-2026-01-22`）；`qwen3-tts-*-realtime` 家族走另一套 `session.finish` / `session.finished` 协议、端点也不同，接两种模型要写两套客户端。

## Azure：调研出局

2026-08-27 调研，没架测试台。

中国区（世纪互联）Speech 服务本身有，F0 免费额度同样是每月 50 万字符，但个人开不了户：1 元试用从 2020-11-30 起停止接受新申请，官方购买路径全是企业合同，实名要营业执照 + 统一社会信用代码 + 法人身份证明 + 企业银行账户，拿身份证走不通。中国区另外不支持自定义语音、个人语音、avatar 和 Voice Live。

全球区个人账号加国际信用卡可以开 F0，每订阅每区域只能有一个 F0 Speech 资源。从中国大陆直连实测（每项 5 次 TLS + HTTP，全部返回 401，握手和路由都通）：japaneast ping 均值 90.1 ms、TCP connect 0.089–0.097 s、TTFB 0.27–0.90 s；eastasia ping 113.5 ms、TTFB 0.33–1.56 s。japaneast 稳定压过 eastasia，两边 ICMP 各丢 10% 但 TCP 十次全成。网络不是它的死因。

死在配额。F0 硬限 20 次请求 / 60 秒，不可调，也没有 batch synthesis：按句合成 40 句一定撞线，只能一次请求合成整段（单请求限音频 10 分钟、SSML 内标签总数 50、WebSocket 单轮 SSML 64 KB），而整段合成要拿句级边界只能靠 SDK 的 bookmark 或 WordBoundary 事件，REST 拿不到。TTS 那 50 万字符约合 27 小时语音够用，STT 每月只有 5 小时且 F0 并发识别数为 1——全双工常开麦先撞死的是 STT 这条。

## 没测，也不打算测

火山 seed-tts-2.0-standard、Gitee AI 托管的 CosyVoice3（Fun-CosyVoice3-0.5B-2512）、腾讯大模型音色档、讯飞超拟人、Fish Audio。原因是选型已经结束，不是它们被否了。将来要换供应商，这份清单和上面的候选表照样管用，各自还缺的是：

- 火山 — 首包实测。`POST /api/v3/tts/unidirectional`，鉴权只有 X-Api-Key / X-Api-Resource-Id / X-Api-Request-Id 三个明文头，没有 HMAC，约一小时能接，控制台点【试用】领 2 万字符。厂商写的「首包 600 ms 左右」描述的是上一代 bigtts，两条流式路的 chunk 粒度一个字都没写。
- Gitee AI CosyVoice3 — 价格（官网未公布）和「是不是攒整句才 flush」。同族、同参数量、境内托管、OpenAI 兼容 `/v1/audio/speech`，改 base URL 和 model id 即可。
- 腾讯 — 零质量证据，一年只省 ¥11，流式接口的采样率在官方同一页里自相矛盾（接口要求表写死 16000/8000，SampleRate 参数表写 24000 部分音色支持），要用得先确认目标音色支不支持 24k。
- 讯飞 — 超拟人没有公开价，只能登录控制台看。那份 ¥1.2–2.0/万字符 是 `xfyun.cn/services/smart-tts` 里「在线语音合成」（老一代）的价格。
- Fish Audio 及其余境外托管 — 这台机器上 TLS 握手 0.5 秒起步，一次握手就吃光 500 ms 预算，而那还是下界（见「一条限定」）。

## 一条限定

延迟数字都是在开发机上测的，第一、二轮走隧道，第四轮把两个域名加进 DIRECT 规则之后是直连。走隧道的那两轮对境内厂商只会更慢不会更快，余量被低估了；但这台机器上测到的任何境外厂商数字都只是下界，不能当结论。真要判境外，只能在 iPad 真机的真实网络上测。
