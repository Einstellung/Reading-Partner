# 国内厂商

> TTS 供应商横评的原始输出，机械转写自 JSON，措辞未改。结论已吸收进 [46](../../46-TTS供应商横评.md)。
>
> 本轮的 JSON 是候选表形态（每个候选一组字段加一个 sourceUrl），不是 companion-research 那种一条 finding 一个 Source/Date/Confidence 的形态，逐条日期与置信度在源数据里就不存在，此处不补。抓取日期统一为 2026-08-27。
>
> Fact-check 一节是核查阶段的结果：verdict 为 corrected 或 refuted 的条目推翻或修正了同一份里的原始值，以那一节为准。其中三条关于硅基流动单价的修正本身是错的，见 [README](./README.md)。
>
> 维度：domestic。题目：大陆开发者能直接调用的国内 TTS 厂商，价格、流式形态、协议工作量、中文质量证据。

---

## Headline

火山引擎 seed-tts-2.0-standard 是唯一在「中文新闻朗读」这项第三方基准上明确胜过现状的候选：CN-NewsTTS Bench v0.1 里它 0.879 排第一，而阿里 CosyVoice v3-plus 只有 0.472、MiniMax speech-2.8-hd 0.548。代价是每分钟 ¥0.0597 对 SiliconFlow 的 ¥0.0299——2 倍，但绝对值是每年 ¥65 对 ¥33，价格在这个用量下不是决策变量。唯一真正的风险在延迟：火山自己的产品简介写「流式调用首包耗时在 600ms 左右」，那会直接违反 p90 < 500ms 这条硬标准，而首帧音频粒度厂商没公布。所以结论是「照现有 40 句方法实测 seed-tts-2.0，别盲换」。另外两件事要说清楚：硅基流动没有更好的模型可换（TTS 目录只有 CosyVoice2-0.5B 和 MOSS-TTSD-v0.5，没有 CosyVoice3 / IndexTTS / Spark / Fish），所以「同厂换模型近乎零成本」这条路是空的；腾讯云大模型音色是唯一真便宜的（¥0.0239/min），但它的流式接口只给 16k/8k 采样率，用音质换钱。

## Candidates

### 火山引擎 / 豆包语音 (Volcengine, ByteDance)

- **模型 ID**：X-Api-Resource-Id: seed-tts-2.0；model 默认 seed-tts-2.0-standard（豆包语音合成大模型2.0，GA）。同族 seed-icl-2.0 为声音复刻。上一代「大模型语音合成」仍在售但更贵。
- **原始价格**：后付费 ¥3/万字符；资源包预付费 10万字¥28(=¥2.8/万字符)、2000万字¥5400(=¥2.7)、2亿字¥48000(=¥2.4)。1个汉字=1字符，标点计费（响应 usage.text_words 明确「含标点」）。UTF-8 字节数不参与计费。
- **¥/min 折算**：¥0.0597/min = 199/10000 × ¥3。预付费最小包 ¥2.8/万字符 → 199/10000 × 2.8 = ¥0.0557/min。3分钟/天 = ¥65/年；10分钟/天 = ¥218/年。是 SiliconFlow 的 2.0 倍，绝对差额 ¥32/年（3分钟档）。
- **免费额度**：控制台点【试用】领：豆包语音合成模型2.0 20000 字符，有效期半年，额度用尽/到期/转正式版即失效，仅首次开通赠送，不续。20000 字符 ≈ 100 分钟朗读，够跑完整轮 40 句延迟基准还有大量富余。另有默认 10 并发不额外收费。
- **流式形态**：三条路都在：①HTTP Chunked 单向流式（一次性送整句文本，流式返回音频）；②WebSocket 单向流式（同上，二进制分帧）；③WebSocket 双向流式（可逐字送文本，适合 LLM 边出字边合成）。按句接力用①或②即可。首帧携带多少音频、chunk 粒度多大——厂商未公布，必须实测。不是「攒完整句再一次性 flush」：②的事件序列是 TTSSentenceStart → 多个 TTSResponse(AudioOnlyServer) → TTSSentenceEnd，明确是增量返回。
- **输出格式**：format 支持 pcm / mp3 / ogg_opus / wav，文档写「流式场景推荐使用 pcm，不建议 wav」。sample_rate 可选 8000/16000/22050/24000/32000/44100/48000，默认 24000——采样率可选，能对齐 VPIO。关键差异：WebSocket 路返回的是二进制帧 raw PCM（MsgType=AudioOnlyServer + PayloadSize 字节数），无 base64；HTTP Chunked 路的音频在 JSON 的 data 字段里是 base64，每 chunk 一次解码。
- **协议与工作量**：HTTP 路是纯 POST，鉴权只有三个请求头 X-Api-Key / X-Api-Resource-Id / X-Api-Request-Id，没有 HMAC 签名、没有 access token 换取——Rust 里就是 reqwest 流式读 chunk + serde_json + base64，几十行。WebSocket 路是自研 V3 二进制分帧（header + event + session id + payload），要手写解帧，量级在一两百行。没有官方 Rust SDK：官方给 Python/Java/Go/C++/Android/iOS，文档页只挂 Python 和 Java 的 demo zip；GitHub 搜 volcengine+tts+language:rust 只有 1 个不相关仓库。
- **延迟说法**：厂商自述，且是负面的：产品简介功能对比表写「大模型语音合成 → 输出单向流式/非流式接口：流式调用首包耗时在 600ms 左右；非流式调用实时率 RTF 约为 0.5」。600ms 首包会直接违反 p90 < 500ms。但这张表是拿「大模型语音合成」（上一代）和「传统语音合成」对比的，未必描述 seed-tts-2.0；表里的采样率信息（单向流只支持 24K/16K/8K）也已经和 2.0 接口文档（含 22050/32000/44100/48000）对不上，说明它至少部分过期。没有可复现的第三方 TTFB 数据。这是唯一挡在推荐前面的未知数。
- **质量证据**：CN-NewsTTS Bench v0.1（arXiv:2606.24714，网易云音乐 Shijun Luo，2026-06-23，TTS 采样日 2026-06-22）：seed-tts-2.0-standard + 默认中文音色，strict accuracy 0.879，Wilson 95% CI [.857,.898]，coverage .913，七个系统里第一。第二名 Azure .756。分类里体育比分 .996、军事 .865，弱项是单位符号 .573 和中外混合品牌名 .391。这个基准量的正是「原始新闻文本不做任何 SSML/LLM 改写，比分、连字号型号、区间、单位、百分号、英文缩写读对没有」——和每日科技新闻简报是同一件事。
- **音色**：产品简介写「大模型语音合成 音色数量 325」（传统合成 84）。2.0 音色列表按场景分类，除「通用场景」外有整块「角色扮演」（知性灿灿、撒娇学妹、甜美桃子…），不是只有新闻主播腔——做陪读伙伴人格有得挑。预置音色不额外收费：计费表里的音色槽位费（¥138/音色起）只针对声音复刻克隆出来的音色，以及旧小模型的「付费精品音库」。另有 context_texts 语音指令（自然语言描述语气，如「你可以用特别特别痛心的语气说话吗」），且该字段文字不计费。还有 aigc_watermark / aigc_metadata 内置 AIGC 标识，对将来上中国区 App Store 是加分。
- **境内可达**：是。openspeech.bytedance.com，境内直连，无需代理。注册要求：新用户注册后必须完成实名认证方可使用；个人实名即可，文档未要求企业资质。认证后控制台一键开通默认 default 项目全部模型并发放免费试用礼包。
- **本维度结论**：值得实测，而且是这一轮唯一值得实测的。理由不是便宜——它比 SiliconFlow 贵一倍——而是它在「中文新闻朗读读音正确率」这项唯一相关的第三方基准上以 .879 对 .472/.548 大幅领先，而每年多花的 ¥32 在这个用量下不构成理由。实测清单：用同一批 40 句、同一隧道、同一 session，走 HTTP Chunked /api/v3/tts/unidirectional（几十行 Rust 就能起）测首帧音频时长占比、RTF、端到端首音频 p50/p90；如果 HTTP 路首帧粒度太粗，再拿 WebSocket 单向流式（raw PCM 二进制帧）复测一遍。免费额度 20000 字符足够跑这两轮。若实测首包真的落在 600ms，就照标准 3 判死，不要因为质量分高而放宽标准。
- **Source**：https://www.volcengine.com/docs/6561/1359370

### 腾讯云 语音合成 TTS（大模型音色档）

- **模型 ID**：不是 model id 制，是音色档位制：通用语音合成分「超自然大模型音色 / 大模型音色 / 精品音色」三档，用 VoiceType 音色 ID 选。此处指大模型音色档。另有长文本语音合成、大模型播客（按 token）两条独立产品线。
- **原始价格**：后付费按日累进：大模型音色 0-10万字符/日 ¥1.2/万字符，10-100万 ¥1.1，100-1000万 ¥0.8。预付费资源包 100万字符¥100(=¥1/万字符) 起。汉字、字母、数字、标点、空格、回车都按一个字符计算。对照：超自然大模型音色 ¥6.5/万字符起，精品音色 ¥0.3/万字符。
- **¥/min 折算**：¥0.0239/min = 199/10000 × ¥1.2。3分钟/天 = ¥26/年；10分钟/天 = ¥87/年。比 SiliconFlow 的 ¥0.0299 便宜约 20%，是这一轮唯一真比现状便宜的大模型档。（超自然档 199/10000 × 6.5 = ¥0.129/min；精品档 199/10000 × 0.3 = ¥0.006/min。）
- **免费额度**：控制台领免费资源包，一个账号只能领一次，领取后三个月内有效：超自然大模型音色 2 万字符、大模型音色 10 万字符、基础/精品音色 800 万字符。10 万字符 ≈ 500 分钟朗读，测试绰绰有余。免费额度用尽产品直接停服，不会自动转后付费（要手动开）。默认并发大模型音色 20 路、超自然 10 路、精品 20 路，免费。
- **流式形态**：实时语音合成接口即「边合成边播放」，WebSocket 增量返回，不是攒整句。音频走 binary 帧返回原始二进制数据，文本信息走 text 帧返回 JSON（含字级时间戳 subtitles，带 BeginTime/EndTime）。首帧携带多少音频、chunk 大小未公布。文本侧另有「流式文本语音合成」接口支持流式送文本。
- **输出格式**：pcm 或 mp3。音频属性写死：采样率 16000Hz 或 8000Hz，采样精度 16bits，单声道。没有 24k——这是它相对 SiliconFlow(24k/44.1k) 和火山(默认 24000，最高 48000) 的实质退步，省下的钱是用音质换的。
- **协议与工作量**：wss://tts.cloud.tencent.com/stream_ws?{请求参数}，签名鉴权（AppID + SecretID + SecretKey 生成签名拼进 query）。比火山的「三个明文 header」多一层签名实现，比阿里 DashScope 的 run-task/task-finished 事件协议简单。Rust 要手写签名，没有官方 Rust SDK。文档明确提示「此接口在参数风格、错误码等方面有区别于云 API 接口」，即不是标准腾讯云 TC3 签名。
- **延迟说法**：厂商未在文档中给出任何首包耗时或 RTF 数字。无第三方实测。
- **质量证据**：none found。腾讯云不在 CN-NewsTTS Bench v0.1 的七个系统里（Volcano/Azure/Google/MiniMax/Aliyun/MiMo/AWS），也没找到其他可复现的中文新闻 TTS 基准或 MOS 数据。大模型音色档的中文新闻读音正确率完全无据。
- **音色**：音色列表按场景分通用、客服、情感、阅读、新闻等；有专门的「新闻」场景音色，也有情感/阅读类可做陪读人格。具体数量文档未在计费页给出，需查音色列表页。超自然大模型音色的并发叠加包只能按单个音色购买，且部分超自然音色不支持买并发——这条对将来扩并发是个坑。
- **境内可达**：是，境内云，直连。需腾讯云账号实名认证；个人实名可用，文档未要求企业。要先在控制台开通语音合成服务并新建密钥（AppID/SecretID/SecretKey）。后付费默认关闭，需手动开启，否则资源包耗尽即停服。
- **本维度结论**：次选，且只在两个前提都成立时才值得测：一是你接受 16kHz（简报只在刷牙时听，16k 未必是问题，但比现状退一档，得先听一段样本再决定）；二是火山实测在延迟上翻车。它是这一轮唯一真便宜的（¥0.024 对 ¥0.030/min），10 万字符免费额度也够测，但质量证据是零——省下每年 ¥7 去赌一个没有任何基准数据的音色档，性价比排序上排在火山之后。
- **Source**：https://cloud.tencent.com/document/product/1073/34112

### 讯飞开放平台（iFlytek）超拟人语音合成

- **模型 ID**：超拟人语音合成，服务端点 v1/private/mcd9m97e6；发音人用 vcn 指定（默认 x5_lingxiaoxuan_flow，文档示例 x5_lingfeiyi_flow）。同平台另有在线语音合成（老一代 WebSocket 流式）、长文本语音合成、一句话复刻。
- **原始价格**：未公布。API 文档只写「官网套餐按照字符调用量进行授权。授权字符总量，一个汉字、英文字母（无论大小写）、阿拉伯数字、标点符号、空格及回车符，均分别计为一个字符」，并提到另有「并发计费售卖套餐，不限制字符使用总量，仅对并发数进行限制」。具体单价只在产品页/控制台购买页里由前端渲染，公开页面（www.xfyun.cn/services/super-smart-tts 的服务端 HTML）里没有任何价格数字，文档中心也没有计费页。
- **¥/min 折算**：无法换算——单价未公布。计费口径已知（1 汉字 = 1 字符，标点空格都算），所以一旦拿到 X 元/万字符，换算就是 199/10000 × X。要拿到数字必须登录控制台看购买页。
- **免费额度**：文档写「测试或正式使用前，请去对应产品页面获取免费额度或下单购买正式套餐」，即确实有免费额度，但具体多少字符、多长有效期、是否续期，公开页面未写明，同样只在产品页/控制台可见。
- **流式形态**：最好的一档：接口明确「支持双向流式通信，即流式的方式输入文本，并流式获取文本合成的音频流。在同一个会话中可以分段多次发送文本并获得音频，合成的音频可以实时播放并且具有低延迟的特点」——正好是按句接力想要的形态，甚至支持一个会话内分段送多句。首帧粒度未公布；有 frame_size 参数（0~1024，默认 0）可能影响返回帧大小，但文档没解释语义。
- **输出格式**：parameter.tts.audio.encoding 可选 raw / lame / speex / opus / opus-wb / opus-swb / speex-wb，文档明确「推荐使用 lame、raw 编解码格式（lame 对应 mp3，raw 对应 pcm），24000 的采样率」。sample_rate 可选 8000/16000/24000，默认 24000。bit_depth 16，单声道。即：raw PCM + 24kHz 可选，格式这一项完全达标。音频在响应 JSON 的 payload 里以 base64 返回，每帧一次解码。
- **协议与工作量**：WebSocket：wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6。鉴权有两种，方式一极简单——控制台拿 APIPassword，直接 x-api-key 请求头传（curl -H 'x-api-key:${APIPassword}'），不用签名；方式二才是 HMAC-SHA256 签名 URL。走方式一的话 Rust 工作量和火山 HTTP 路相当。消息体是讯飞统一的 header/parameter/payload 三段 JSON，不是二进制分帧，比火山 V3 好写。无官方 Rust SDK（Python/Java/Android/Linux）。
- **延迟说法**：仅有定性说法「具有低延迟的特点」，无任何数字。无第三方实测。
- **质量证据**：none found。不在 CN-NewsTTS Bench v0.1 的七系统里，也没找到其他可复现的中文新闻朗读基准。
- **音色**：发音人列表另页，数量未在 API 文档中给出。命名（灵小璇、灵飞逸等 x5_*_flow 系列）显示是新一代超拟人音库；有 oral_level 口语化程度、remain 是否保留书面语（控制填充语、语气词、重复语）等参数，做陪读伙伴的口语感有抓手。
- **境内可达**：是，cn-huabei-1.xf-yun.com，境内直连。讯飞开放平台个人开发者可注册；使用发音人前需在控制台开通对应发音人权限（文档在 vcn 参数处注明「正式调用前需要在控制台开通对应发音人的权限」），这一步是额外摩擦。
- **本维度结论**：技术形态是所有候选里最贴合这个架构的（真双向流式、24kHz raw PCM、x-api-key 一行鉴权、同会话分段送句），但没有价格就无法排进性价比序列，而且中文新闻质量零证据。处理办法：如果你愿意花五分钟登录讯飞控制台把超拟人的套餐单价和免费额度抄出来，它值得当第三候选测一轮；在拿到数字之前不要投入实现工作。
- **Source**：https://www.xfyun.cn/doc/spark/super%20smart-tts.html

### 硅基流动 SiliconFlow（现状基准，非新候选）

- **模型 ID**：FunAudioLLM/CosyVoice2-0.5B（在用）。整个 TTS 目录只有它和 fnlp/MOSS-TTSD-v0.5 两个模型——后者是双人对话/播客向（[S1][S2] 标记自动切换说话人），不是单人朗读用的。没有 CosyVoice3、没有 IndexTTS、没有 Spark-TTS、没有 fishaudio 独立条目（代码注释里残留的「支持 fishaudio / GPT-SoVITS / CosyVoice2-0.5B 系列模型」是历史遗留，文档正文的「支持模型列表」只列了上面两个）。
- **原始价格**：¥0.05 / 1000 UTF-8 字节。官方文档确认计费口径：「按照输入文本长度对应的 UTF-8 字节数进行计费」，并提供在线字节计数器。汉字在 UTF-8 下通常 3 字节。
- **¥/min 折算**：¥0.0299/min = 199 汉字 × 3 字节 = 597 字节；597/1000 × ¥0.05 = ¥0.0299。3分钟/天 = ¥33/年；10分钟/天 = ¥109/年。（此前记录的 ¥0.039/min 隐含约 260 个计费字符/分钟，即把中文标点也算进去——中文全角标点同样 3 字节，按约 30% 标点占比就是这个数。两个口径都对，差别只在标点。）
- **免费额度**：注册赠额度（金额随活动变动，公开页未在文档中固定）。使用用户预置音色和动态音色需要实名认证。
- **流式形态**：OpenAI 兼容 /v1/audio/speech，stream=true 增量返回。已实测：首帧 42.7ms 音频（p50，占整句 0.9%），RTF 0.118，请求到首个 PCM 225ms，端到端 317.7 p50 / 350.9 p90，40/40 成功。这是目前唯一一组自测数据，也是其他候选要打的靶子。
- **输出格式**：response_format 支持 mp3 / opus / wav / pcm。sample_rate 可选：wav/pcm 支持 8000/16000/24000/32000/44100（默认 44100），mp3 支持 32000/44100，opus 仅 48000。raw PCM + 采样率可选，格式这项满分。
- **协议与工作量**：OpenAI 兼容 HTTP POST，Bearer token。Rust 侧最省事的一档，且已经跑通。
- **延迟说法**：厂商无公布数字；已有自测数据（见 streaming 栏），是全场唯一有实测的一行。
- **质量证据**：none found。CosyVoice2-0.5B 不在 CN-NewsTTS Bench v0.1 里。可用的最近旁证是负面的：同族更大更新的 cosyvoice-v3-plus 在该基准上只有 0.472（七系统第五），单位符号类 .021、体育比分 .134。这是对 v3-plus 的实测，不是对 CosyVoice2-0.5B 的实测，不能直接搬——但方向上说明 CosyVoice 系在原始新闻文本的读音规整上是弱项，而 0.5B 是更小更老的开源版本，没有理由假设它比 v3-plus 好。
- **音色**：系统预置仅 8 个：男声 alex/benjamin/charles/david，女声 anna/bella/claire/diana。要更多就得自己上传参考音频做克隆（支持 base64 或文件上传，建议 8~10 秒素材），或用动态音色（每次请求带 references）。做陪读伙伴人格得自己养音色，不像火山有几百个现成的含角色扮演类。
- **境内可达**：是，api.siliconflow.cn 境内直连，已在用。部分功能（用户预置音色、动态音色）需实名认证。
- **本维度结论**：留着当基准，但「同厂换个更好的模型」这条最省力的路已经确认是死路——目录里没有 CosyVoice3/IndexTTS/Spark 可换，MOSS-TTSD-v0.5 是双人播客向，换过去反而不对。它在延迟和价格上仍然是全场最好，短板是质量证据为零且旁证不利。所以真正的问题不是「有没有更便宜的」，而是「你现在这把声音把新闻里的比分、型号、单位念对了吗」——这件事只有实测火山之后对比才知道。
- **Source**：https://docs.siliconflow.cn/cn/userguide/capabilities/text-to-speech

### MiniMax（稀宇）

- **模型 ID**：speech-2.8-hd / speech-2.8-turbo（当前主力，GA）；旧版 speech-2.6-hd / speech-2.6-turbo / speech-02-hd / speech-02-turbo 仍在价目表上。接口：T2A（同步语音合成）、T2A Async（异步长文本）。也被阿里云百炼转售为 MiniMax/speech-2.8-hd。
- **原始价格**：按量计费：speech-2.8-hd ¥3.5/万字符，speech-2.8-turbo ¥2/万字符。计费口径明确写「1个汉字算2个字符，英文字母、希腊字母、标点符号、特殊符号、空格、回车等算1个字符」——这是全场唯一把汉字算两个字符的（阿里 qwen3-tts 同口径）。语音资源包：HD 系列 200万字符原价¥700/折后¥630（1个月，RPM 60，送 10 个快速克隆音色），2000万字符¥5950（3个月，RPM 200），2亿字符¥56000（1年，RPM 500）。音色设计/快速复刻各 ¥9.9/音色。
- **¥/min 折算**：speech-2.8-hd：199 汉字 × 2 = 398 计费字符；398/10000 × ¥3.5 = ¥0.139/min。3分钟/天 = ¥153/年；10分钟/天 = ¥508/年。speech-2.8-turbo：398/10000 × ¥2 = ¥0.0796/min。HD 走最小资源包（¥630/200万字符 = ¥3.15/万字符）也要 ¥0.125/min。即 HD 是 SiliconFlow 的 4.7 倍、火山 2.0 的 2.3 倍。
- **免费额度**：公开定价页只列付费资源包和 Token Plan，未列免费试用额度；平台注册赠额度的规则未在定价文档中写明。音色复刻/设计费用在首次用该音色合成时才收，7 天内未正式调用的复刻音色会被系统删除。
- **流式形态**：齐全：同步语音合成 HTTP（支持 stream）、同步语音合成 WebSocket、以及「同步语音合成 WebSocket（双向流式）——支持文本流式输入的接口，客户端可逐字发送文本，由服务端自动攒句合成」。注意最后这条的「服务端自动攒句」措辞：双向流式那条路是按句攒的，单句延迟特性需实测。
- **输出格式**：T2A v2 支持 mp3 / pcm / flac，比特率和采样率可调（文档描述「支持比特率、采样率相关参数调整特性」，最高 44.1k）。流式 HTTP 返回的音频是十六进制编码字符串，需每 chunk 解码一次。
- **协议与工作量**：自研 REST + SSE，或自研 WebSocket。不是 OpenAI 兼容，但也不是重量级会话协议，Rust 工作量中等。有官方 MCP server。
- **延迟说法**：公开文档未给首包耗时或 RTF 数字。无第三方实测。
- **质量证据**：CN-NewsTTS Bench v0.1：speech-2.8-hd（Mandarin news 音色）strict accuracy 0.548，95% CI [.517,.579]，coverage .850，七系统第四。分类里体育比分 .000（把比分连字号读成区间，如 96-91 读成「九十六到九十一」），单位 .542，军事 .448，品牌 .484。对一份科技新闻简报来说，比分不是高频项，但型号名和单位是——0.548 和火山的 0.879 差得不是一星半点。
- **音色**：系统音色列表另页（docs/faq/system-voice-id），含 Mandarin news 等场景音色；支持音色设计（文字描述生成音色，¥9.9/个）和快速复刻。做陪读人格有工具，但每个音色 ¥9.9 一次性。
- **境内可达**：是，platform.minimaxi.com 境内直连（国内站与国际站 minimax.io 分开）。音色复刻接口要求「调用本接口前，请先完成个人或企业认证」——个人认证即可。
- **本维度结论**：不值得测，直接排除。它在唯一相关的第三方基准上 0.548，明显低于火山 0.879，同时因为「1 汉字 = 2 字符」的计费口径，每分钟 ¥0.139 是火山 2.0 的 2.3 倍、SiliconFlow 的 4.7 倍。质量更差、价格更贵，两头都输，没有需要实测才能翻案的余地。turbo 档 ¥0.0796/min 仍贵于火山 2.0 且质量只会更低（基准测的是 hd）。
- **Source**：https://platform.minimaxi.com/docs/guides/pricing-paygo.md

### 阿里云百炼（Alibaba Bailian / DashScope）——qwen3-tts-flash 之外的其它 TTS

- **模型 ID**：当前完整阵容：Qwen-Audio-TTS 系（qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-flash，官方首推，比已实测的 qwen3-tts-flash 更新）；CosyVoice 系（cosyvoice-v3.5-plus / v3.5-flash 仅北京且只支持声音复刻与设计、无系统音色；cosyvoice-v3-plus；cosyvoice-v3-flash；cosyvoice-v2；cosyvoice-v1）；Qwen3-TTS 系（qwen3-tts-flash 及 -realtime、qwen3-tts-instruct-flash 支持指令控制、qwen3-tts-vc 复刻、qwen3-tts-vd 设计）；Sambert（早期模型，官方说新项目别用）；外加转售的 MiniMax/speech-2.8-hd 等。
- **原始价格**：qwen3-tts-flash ¥0.8/万字符、1 汉字算 2 字符（上一轮已确认）。cosyvoice-v3-plus / qwen-audio-3.0-tts-* 的单价：未能从可达的官方页面取到——百炼把每个模型的价格放在模型广场的模型卡里由前端渲染，help.aliyun.com 上的 tts-model 选型页和 models 索引页都只有能力对比、没有价格表。
- **¥/min 折算**：仅 qwen3-tts-flash 可算：199 × 2 = 398 计费字符；398/10000 × ¥0.8 = ¥0.0318/min。3分钟/天 = ¥35/年。与 SiliconFlow 的 ¥0.0299 基本持平（贵 6%）。cosyvoice-v3-plus 与 qwen-audio-3.0-tts 系无法换算——单价未取到。
- **免费额度**：百炼新模型通常有限时免费额度，但未在我能取到的页面上给出 TTS 各模型的具体字符数与有效期。未公布。
- **流式形态**：Qwen-Audio-TTS / CosyVoice 系同一个 model 名同时支持 WebSocket（双向流式，流式输入 + 流式输出）和 HTTP（送完整文本、逐段流式返回）；Qwen3-TTS 系用后缀区分（-realtime 走 WebSocket，不带后缀走 HTTP）。CosyVoice 系另有 AOQ 协议，官方说法是「客户端对接、更看重稳定的延迟和弱网交互」时优先。已实测的 qwen3-tts-flash 首帧固定 320.9ms（占 6.6%），RTF 0.243。
- **输出格式**：PCM / WAV / MP3 / Opus，最高 48kHz；WebSocket 路可指定 format 和 sample_rate（示例用 mp3 22050）。Realtime 路支持 PCM_24000HZ_MONO_16BIT。已实测的 qwen3-tts-flash 走 SSE 时是 base64 PCM、24kHz 固定。
- **协议与工作量**：DashScope 自研 WebSocket 事件协议：run-task（streaming: duplex）→ continue-task → task-finished/task-failed，带 task_id 管理、连接可复用（任务结束 60 秒无新任务自动断开）、不同任务必须用不同 task_id。比火山 HTTP 路重不少。官方 SDK 只有 Python/Java（含 Android/iOS），无 Rust。另注意 WebSocket 端点带 WorkspaceId：wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference。
- **延迟说法**：文档只有定性的「支持流式输入与输出，首包延迟低」，SDK 提供 get_first_package_delay() 让你自己量，且明确提示「首次发送文本时需建立 WebSocket 连接，因此首包延迟会包含连接建立的耗时」。无厂商数字，无第三方实测。
- **质量证据**：CN-NewsTTS Bench v0.1：cosyvoice-v3-plus（音色 longanyang）strict accuracy 0.472，95% CI [.441,.503]，coverage 仅 .533（七系统里最低之一），七系统第五。分类里单位符号 .021（近乎全错）、体育比分 .134、军事 .198、品牌 .281。这是阿里旗舰 CosyVoice 的成绩，不是 qwen-audio-3.0 的——后者未被该基准测过。
- **音色**：系统音色按模型版本分套（cosyvoice-v3 系用 longanyang 等，v2 用 longxiaochun_v2 等，qwen-audio-3.0 用 longanhuan_v3.6 等），版本间音色不通用——换模型要换音色 ID。支持指令控制（qwen-audio-3.0-tts-plus/flash、cosyvoice-v3.5-*、cosyvoice-v3-flash、qwen3-tts-instruct-flash），可用自然语言描述语气语速情绪；方言覆盖很广（复刻音色支持二十余种中国方言）。
- **境内可达**：是，dashscope.aliyuncs.com / maas.aliyuncs.com 境内直连（新加坡与北京地域 API Key 不同）。阿里云账号实名即可，个人可用。
- **本维度结论**：不值得再测。你已经实测过 qwen3-tts-flash（首帧固定 320.9ms / 6.6%，RTF 0.243，端到端 360.2/394.8，39/40），性能全面输给 SiliconFlow；而阿里这条线上唯一有第三方质量数据的 cosyvoice-v3-plus 只有 0.472，是七系统第五、单位符号 .021。也就是说阿里的旗舰 TTS 在新闻文本读音上比你现在用的可能还差，价格又和 SiliconFlow 持平（¥0.0318 对 ¥0.0299）。唯一还没被任何数据覆盖的是 qwen-audio-3.0-tts-plus/flash（官方新首推），但它连单价都没公开，且要走 DashScope 事件协议——在火山实测出结果之前不值得为它花时间。
- **Source**：https://help.aliyun.com/zh/model-studio/tts-model

## Ruled out

- 火山引擎「大模型语音合成」（上一代 bigtts，非 2.0）：后付费 ¥5/万字符 → 199/10000×5 = ¥0.0995/min，比同厂 seed-tts-2.0 的 ¥0.0597 贵 67%，而基准测的正是 2.0。同厂被自家新模型全面替代，失「价格」这一项，没有任何选它的理由。
- 火山引擎 豆包音频生成模型 1.0（Seed-Audio 1.0）：只有非流式 HTTP 接口、单次合成人声文本建议 400 字符以内、按分钟计费 ¥1/分钟（= ¥1/min，是 seed-tts-2.0 的 17 倍）。失标准 1（根本不流式）和价格，是影视级音频创作工具不是朗读接口。
- 腾讯云 超自然大模型音色档：¥6.5/万字符 → ¥0.129/min，是同厂大模型音色档的 5.4 倍、SiliconFlow 的 4.3 倍，采样率同样卡在 16k/8k，且并发叠加包只能按单个音色买、部分音色还不支持买。没有质量证据支撑这个溢价。
- 腾讯云 精品音色档：¥0.3/万字符 → ¥0.006/min，全场最便宜（800 万字符免费额度 ≈ 40000 分钟），但那是上一代非大模型 TTS，正是 CN-NewsTTS Bench 里 AWS Polly(.244)/MiMo(.275) 那一档技术的同类。这个项目的痛点是新闻文本读音正确率，用小模型是往回走。
- MiniMax speech-2.8-turbo / speech-2.6 / speech-02 系：turbo ¥0.0796/min 仍贵于火山 2.0，且基准测的 hd 档就只有 .548，turbo 只会更低。2.6/02 是旧版，价格与 2.8 同档，无理由选。
- 百度智能云 大模型语音合成：产品页确认有「大模型语音合成」在售（含情感标签句级控制、5 秒声音复刻、离在线融合 SDK），但价格在产品页和文档中心均由前端渲染，doc/SPEECH 文档索引下根本没有计费页，公开 HTML 里取不到任何单价——无法换算 ¥/min。同时不在 CN-NewsTTS Bench 七系统内，无任何中文新闻朗读质量证据，协议是百度云 AK/SK 换 access token 的自有体系。失「价格可核实」与「质量有据」两项。
- 华为云 SIS 语音合成：support.huaweicloud.com 的定价文档被 EdgeOne 人机校验挡住（返回「Security Verification Protected by Tencent Cloud EdgeOne」），价格、协议、输出格式一概取不到。产品线是传统小模型 TTS，不在任何基准里。无据可依，本轮排除。
- Fish Audio（fish.audio）：定价页是纯客户端渲染的 SPA（服务端 HTML 只有 33 字符的标题），docs.fish.audio/resources/pricing 返回空——拿不到任何官方价格。不在 CN-NewsTTS Bench 七系统内。主站在境外，境内直连可用性未能验证。这一维度的前提是「大陆开发者能直接调的国内厂商」，它三条都不满足。
- 硅基流动 fnlp/MOSS-TTSD-v0.5：是双人对话/播客模型（输入用 [S1][S2] 切换说话人，主打双人语音克隆），不是单人朗读模型。换过去形态就不对，失用途匹配。
- 小米 mimo-v2.5-tts：你已按首包 1100–1900ms 判死（失标准 3）。补一条独立佐证：CN-NewsTTS Bench v0.1 上 mimo-v2.5-tts（音色白桦）strict accuracy 0.275，七系统第六，体育比分 .000、军事 .000。延迟和质量两头都在底部，排除是对的。
- Azure / Google / AWS（基准里的境外三家，供对照不作候选）：Azure .756 是七系统第二、且 coverage 1.000（最保守稳定），Google .604，AWS Polly .244。Azure 质量确实排在阿里/MiniMax 之上，但境内无代理直连不可靠、注册与付款走境外主体，不符合这一维度的前提；列出来只是为了说明火山的 .879 是在有 Azure 参赛的情况下拿的第一。

## Open questions

- 火山 seed-tts-2.0 的真实首包延迟——这是唯一能否决推荐的未知数。厂商自己的产品简介写「流式调用首包耗时在 600ms 左右」，若属实直接违反 p90 < 500ms。但那张表描述的是上一代「大模型语音合成」，且表里的采样率信息已与 2.0 接口文档矛盾（表说单向流只支持 24K/16K/8K，接口文档给到 22050/32000/44100/48000），说明它至少部分过期。必须用你那 40 句、同隧道同 session 实测，不能采信也不能仅凭这句话否决。
- 火山两条流式路的首帧音频粒度都没公布：HTTP Chunked 路每个 chunk 的 base64 音频对应多少毫秒、WebSocket 路每个 AudioOnlyServer 帧的 PayloadSize 是多少字节，文档一个字都没写。标准 1（首帧 < 0.4 句）能不能过，只有实测知道。建议两条路都测：HTTP 路便宜好写先跑，若首帧粒度太粗再上 WebSocket raw PCM。
- seed-tts-2.0 是否还有 standard 之外的档位。接口文档写 model 参数「默认值为 seed-tts-2.0-standard」，standard 这个后缀强烈暗示存在 lite/pro 之类的同族，但模型列表文档里搜不到第二个 seed-tts-2.0-* 名字，只找到 seed-icl-2.0。而基准测的恰好就是 standard，所以即使有别的档，测 standard 是对的——但如果存在更快的 lite 档，可能是延迟问题的解法。开通后在控制台确认。
- 讯飞超拟人的单价和免费额度。它的技术形态是全场最贴合的（真双向流式、24kHz raw PCM、x-api-key 单请求头鉴权、同会话分段送句），但价格只在登录后的控制台购买页可见，公开页面完全没有。拿到「X 元/万字符 + 免费额度字符数/有效期」这两个数字之前，它无法排进性价比序列。
- 腾讯云 16kHz 够不够用。它是唯一真便宜的（¥0.0239/min，比现状省 20%），但实时语音合成接口的采样率写死 16000 或 8000，没有 24k。这不是技术问题是听感问题——用 10 万字符免费额度合一段简报，戴上你平时刷牙时用的设备听，能接受就值得测延迟，不能接受就直接出局。
- CosyVoice2-0.5B 在这项任务上到底多差，目前只有推断没有实测。CN-NewsTTS Bench 没测它，只测了同族更大更新的 cosyvoice-v3-plus（0.472，单位符号 .021、体育比分 .134）。0.5B 是更小更老的开源版本，没有理由假设它更好，但这终究是推断。最省事的验证：从基准的 800 条公开测试集里挑几十条科技新闻类的（含型号名、单位、百分比、英文缩写），用你现在的 CosyVoice2 合出来听一遍，同一批句子再用火山合一遍——这比任何基准分数都更贴你的实际语料。
- 火山按句接力时的并发计数。计费文档对并发的定义是「某一时刻后端服务同时处理的请求数」，按句接力意味着当前句在播、下一句在合成，稳态下并发是 1~2，远在免费的 10 并发之内。但如果将来陪读伙伴要多路同时说话，超出部分是 ¥100/并发/月——这个价格档位比调用费本身贵得多，值得在架构上避免。
- 阿里 qwen-audio-3.0-tts-plus/flash 的单价完全未公布，而它是阿里官方当前首推、比你测过的 qwen3-tts-flash 更新的一代。基准没测它。这是本轮唯一「可能有惊喜但数据全缺」的条目，不过在火山出实测结果之前不值得为它花时间。

## Fact-check

### [REFUTED] iFlytek 超拟人语音合成 has no publicly findable unit price; only the char-counting rule (1汉字=1字符 incl. punctuation) and a mention of a separate concurrency-based plan are public

- **Correction**：Public pricing exists: ¥1.20-2.00/万字符 across prepaid tiers (before promo). Recomputed ¥/min at 199汉字/分钟: entry tier ¥0.0398/min, best committed tier ¥0.0239/min (≈¥0.0184/min with the +30% promo) — i.e. iFlytek is more expensive than SiliconFlow's ¥0.0299/min at the entry tier and only cheaper at the largest prepaid commitment, not literally unpriced.
- **Evidence**：Teammate ttsquality found a full public price table on https://www.xfyun.cn/services/smart-tts, embedded in the page's Next.js __NEXT_DATA__ payload (invisible to a plain-HTML/text scrape, which explains why the API-doc page alone showed no numbers). Table: 套餐一 ¥1000/500万字符(+30% promo→650万)=¥2.00/万字符(promo ¥1.54); 套餐二 ¥3600/2000万字符=¥1.80; 套餐三 ¥15000/1亿字符=¥1.50; 套餐四 ¥60000/5亿字符=¥1.20/万字符(promo ~¥0.92). A separate unlimited-character concurrency-only plan is also confirmed to exist, priced on enquiry.

### [REFUTED] iFlytek free tier exists but amount/duration/renewal are not publicly documented

- **Correction**：Personal free tier is 1万字符/3个月 (enterprise 5万字符/3个月), one-time via real-name verification — publicly stated on the product page, not console-only.
- **Evidence**：Same public page: 个人认证礼包 = 1万字符, 3个月有效期, requires real-name auth to claim ('完成实名认证，即可免费领取'); 企业认证礼包 = 5万字符/3个月. This is a specific, findable number, not an undocumented quantity.

### [CORRECTED] Tencent audio is hard-fixed to 16000Hz or 8000Hz with no 24k option, a real quality tradeoff vs. SiliconFlow/Volcengine

- **Correction**：24000Hz is documented as available for supported voices (voice-dependent), not universally absent; Tencent's own docs are internally inconsistent between the summary table and the parameter reference.
- **Evidence**：Same official page (product/1073/94308) contains two conflicting statements: the general '接口要求' summary table does say '采样率：16000Hz 或 8000Hz' (matching the claim), but the actual SampleRate request-parameter reference table on the same page explicitly states '24000：24k（部分音色支持，请参见音色列表）' — i.e. 24kHz IS available for select voices. The claim's 'no 24k, real quality tradeoff' framing is not accurate as an absolute statement; it depends on voice selection.

### [CORRECTED] SiliconFlow response_format supports mp3/opus/wav/pcm; sample_rate wav/pcm 8000-44100 (default 44100), mp3 32000/44100, opus 48000 only

- **Correction**：Default sample_rate is 24000Hz, not 44100Hz, when the parameter is omitted; response_format also supports flac in addition to mp3/opus/wav/pcm.
- **Evidence**：ttsquality probed the live API's own 400-error messages: 'sample rate of wav/pcm should be 8000hz, 16000hz, 24000hz, 32000hz or 44100hz' ✓, mp3 32000/44100 ✓, opus 48000 ✓ — the allowed-values lists match. But the DEFAULT when sample_rate is omitted is 24000Hz (verified via WAV header), not 44100 as claimed. The format list is also incomplete: response_format additionally accepts flac (verified via magic bytes and content-type).

### [UNVERIFIABLE] Volcengine free tier: 20000 chars, half-year validity, one-time only, granted via console trial button

- **Evidence**：Not found on any public docs/pricing/product page I could reach (billing doc, product page voice-tts) — this detail is console-UI-gated as the candidate itself states. Not contradicted, just not independently confirmable from a public primary source.

### [UNVERIFIABLE] MiniMax T2A v2 streaming HTTP audio is hex-encoded (not base64), requiring per-chunk decode; proprietary REST+SSE or WebSocket protocol (not OpenAI-compatible); official MCP server exists; platform.minimaxi.com is mainland-direct, separate from minimax.io

- **Evidence**：Not independently re-confirmed by me or by any teammate in this run (assigned to mimolatency, which did not return a report in time despite three follow-up prompts and ~50 minutes of runtime). Not contradicted by anything found, but I cannot cite a primary source for the hex-vs-base64 detail specifically or the China/international domain-separation claim.

### [UNVERIFIABLE] cosyvoice-v3-plus and qwen-audio-3.0-tts-plus/-flash prices are not published on public help.aliyun.com pages, only visible in the login-gated console model-card UI

- **Evidence**：I independently attempted bailian.console.aliyun.com/model-market and got no renderable price content (login/JS-gated), consistent with the claim. Could not find a public price via any other page reached.

### [UNVERIFIABLE] Overarching: using 199 汉字/分钟 as the comparison basis for ¥/min across vendors

- **Evidence**：This is a fixed input given by the task, not itself a vendor claim to verify. Worth flagging: ttsquality's live measurement of actual TTS narration on tech-briefing-style text found a real synthesized rate of ≈333 billable chars/min (69% above 199) at defaults, meaning real-world per-minute-of-audio cost for any vendor is likely materially higher than the 199-basis figures suggest — though since this applies roughly proportionally across vendors, it should not flip the relative ranking, only the absolute ¥/min scale.

### [CONFIRMED] Volcengine seed-tts-2.0-standard postpaid price is ¥3/万字符; prepaid packs 10万字¥28(=2.8), 2000万字¥5400(=2.7), 2亿字¥48000(=2.4)/万字符; 1汉字=1字符 incl. punctuation; UTF-8 byte count not used for billing

- **Evidence**：Live-rendered docs.volcengine.com/docs/6561/1359370 (计费说明--豆包语音-火山引擎) shows postpaid table row 豆包语音合成模型2.0 = 3元/万字符, and prepaid table rows 10万字→2.8元/万字符, 2000万字→2.7元/万字符, 20000万字(=2亿字)→2.4元/万字符 (a further undisclosed tier 200000万字→2.1元/万字符 also exists). Footnote verbatim: '1个汉字算1个字符...标点符号、特殊符号、空格、回车等算1个字符' and '调用字符需要使用UTF-8编码...计费使用字符数，与字节数无关'.

### [CONFIRMED] Volcengine ¥/min: postpaid 199/10000×3=¥0.0597/min; cheapest prepaid 199/10000×2.8=¥0.0557/min

- **Evidence**：Arithmetic matches confirmed raw prices exactly; recomputed independently, both within 0% of claim.

### [CONFIRMED] Volcengine offers 3 streaming paths (HTTP Chunked unidirectional, WebSocket unidirectional, WebSocket bidirectional); bidirectional event sequence is TTSSentenceStart → multiple TTSResponse(AudioOnlyServer) chunks → TTSSentenceEnd, i.e. genuinely incremental not buffer-then-flush

- **Evidence**：Current (non-deprecated) 同步语音合成 nav on docs.volcengine.com lists exactly: 单向流式语音合成HTTP / 单向流式语音合成WebSocket / 双向流式语音合成WebSocket. The bidirectional doc's own example event log shows ConnectionStarted→SessionStarted→TTSSentenceStart→AudioOnlyServer(PayloadSize 2349)→AudioOnlyServer(PayloadSize 3264)→TTSSentenceEnd→SessionFinished→ConnectionFinished — two separate audio chunks before sentence-end, i.e. genuinely incremental.

### [CONFIRMED] Volcengine output: format pcm/mp3/ogg_opus/wav, docs say streaming should use pcm not wav; sample_rate options 8000/16000/22050/24000/32000/44100/48000 default 24000

- **Evidence**：Doc text verbatim: '流式场景推荐使用[pcm]，不建议使用[wav]'. Sample rate cells list exactly 8000/16000/22050/24000(default)/32000/44100/48000 for the wav/pcm formats.

### [CONFIRMED] Volcengine quality: seed-tts-2.0-standard strict accuracy 0.879 [Wilson 95% CI .857-.898], coverage .913, #1 of 7 systems; sports .996, military .865, weak: unit/symbol .573, mixed CN/EN brand .391

- **Evidence**：Teammate ttsbench read arXiv:2606.24714 (CN-NewsTTS Bench v0.1) full text directly: Table 5 gives Volcano .879 [.857,.898] Cov .913, rank #1 of 7; Table 7 gives Sports .996, Unit .573, Mil. .865, Brand .391 — exact match. Paper calls the system 'Volcano/Doubao TTS', configured as seed-tts-2.0-standard per its Table 8.

### [CONFIRMED] Tencent 大模型音色 postpaid tiered: 0-10万字/日 ¥1.2/万字符 (10-100万¥1.1, 100-1000万¥0.8); all char types incl. punctuation/space/newline count as 1 char each

- **Evidence**：cloud.tencent.com/document/product/1073/34112 fetched directly: 大模型音色 postpaid tiers 0-10:¥1.2, 10-100:¥1.1, 100-1000:¥0.8 (further tiers to ¥0.55 at scale). Verbatim: '汉字、字母、数字、标点符号、特殊符号、空格和回车都按一个字符计算'.

### [CONFIRMED] Tencent ¥/min = 199/10000×1.2=¥0.0239/min, about 20% cheaper than SiliconFlow's ¥0.0299/min

- **Evidence**：Arithmetic matches exactly; (0.0299-0.0239)/0.0299=20.07%, matching the claimed ~20%.

### [CONFIRMED] Tencent free tier: 大模型音色 10万字符, valid 3 months, one account can claim once

- **Evidence**：Same doc page: 'Users receive valid for three months free resources... Large-model: 10万字符... 一个账号只能领取一次' — exact match.

### [CONFIRMED] Tencent streaming returns binary frames for audio and JSON text frames for subtitles with word-level BeginTime/EndTime

- **Evidence**：Doc: '音频信息通过 binary 类型帧，返回原始二进制数据。文本信息通过 text 类型帧，返回 JSON 格式数据（如状态码、时间戳等）' plus a subtitles schema with BeginTime/EndTime fields.

### [CONFIRMED] Tencent protocol differs from standard cloud API (own signing/error codes), no official Rust SDK (only Java/Python/C++/Go)

- **Evidence**：Doc verbatim: '此接口为实时语音合成接口，在参数风格、错误码等方面有区别于云 API 接口，请知悉。' SDK section lists only Java, Python, C++, Go GitHub repos — no Rust.

### [CONFIRMED] Tencent has no findable pronunciation-accuracy benchmark data (not in CN-NewsTTS Bench v0.1 or elsewhere)

- **Evidence**：ttsbench's full-text search of arXiv:2606.24714 found 0 hits for 'Tencent' or '腾讯' anywhere in the paper; the 7 tested systems are Volcano/Azure/Google/MiniMax/Aliyun/MiMo/AWS only.

### [CONFIRMED] iFlytek supports genuine bidirectional streaming (client sends text incrementally in one session, server streams audio back with low latency), suited to LLM word-by-word input

- **Evidence**：Doc verbatim, independently fetched by both me and ttsquality: '接口支持双向流式通信，即流式的方式输入文本，并流式获取文本合成的音频流。在同一个会话中可以分段多次发送文本并获得音频，合成的音频可以实时播放并且具有低延迟的特点；适用于大语言模型的逐字输入型、流式文本入参形式的场景。' Protocol backs it: payload.text carries status(0/1/2) and seq fields supporting genuine multi-segment sends.

### [CONFIRMED] iFlytek frame_size (0-1024, default 0) parameter's semantics are undocumented

- **Evidence**：The only text anywhere on the doc page for this field is the table row itself: 'frame_size 帧大小 int 最小值:0,最大值:1024 默认0 帧大小，默认0' — circular, no semantic explanation, in both request and response schemas.

### [CONFIRMED] iFlytek output: encoding raw/lame/speex/opus/opus-wb/opus-swb/speex-wb; docs recommend lame(mp3)/raw(pcm) @24000Hz; sample_rate 8000/16000/24000 default 24000; bit_depth 16 mono; audio returned as base64 in payload

- **Evidence**：Doc verbatim: encoding cell lists exactly 'raw,lame, speex, opus, opus-wb, opus-swb, speex-wb'; recommendation text '推荐使用[lame、raw]编解码格式（lame对应mp3格式音频，raw对应pcm格式音频），24000的采样率'; sample_rate cell '16000, 8000, 24000' default '24000'; response payload.audio.audio is a base64 string field. One trap the claim missed: if the encoding field is omitted, the actual default is speex-wb, not raw/lame.

### [CONFIRMED] iFlytek has two auth methods: (a) x-api-key header with console-issued APIPassword, no signature; (b) HMAC-SHA256 signed URL; no official Rust SDK (Python/Java/Android/Linux only)

- **Evidence**：Doc shows method one literally as 'curl -H x-api-key:${APIPassword} wss://cbm01.cn-huabei-1.xf-yun.com/v1/private/mcd9m97e6' (no signature), and method two's Python sample computes hmac-sha256 over 'host date request-line'. SDK links present: Python/Java demo zips, Android SDK doc, Linux SDK doc; zero mentions of Rust.

### [CONFIRMED] iFlytek is mainland China direct-connect (cn-huabei-1.xf-yun.com), personal developers can register, and each voice (vcn) must be separately enabled in the console before use

- **Evidence**：Endpoint confirmed as cn-huabei-1 (华北1); public pricing page explicitly targets 个人开发者; request example carries the comment '参考发音人列表，正式调用前需要在控制台开通对应发音人的权限' verbatim. Extra gotcha not in the claim: the documented default vcn (x5_lingxiaoxuan_flow) is not actually among the 5 free default voices (all x6_*), so calling with the documented default risks a permission error.

### [CONFIRMED] iFlytek has no findable Chinese-news-TTS pronunciation benchmark data

- **Evidence**：ttsbench confirmed 0 hits for 'iFlytek'/'讯飞' anywhere in arXiv:2606.24714's full text — not among the 7 tested systems.

### [CONFIRMED] SiliconFlow's TTS catalog currently contains only FunAudioLLM/CosyVoice2-0.5B and fnlp/MOSS-TTSD-v0.5 (dialogue model), no CosyVoice3/IndexTTS/Spark-TTS/standalone fishaudio

- **Evidence**：Live API call `GET /v1/models?sub_type=text-to-speech` (ttsquality) returned exactly these two models. Docs page also lists only these two under '支持模型列表' and warns the list may change.

### [CONFIRMED] SiliconFlow bills ¥0.05 per 1000 UTF-8 bytes of input text (not per character)

- **Evidence**：docs.siliconflow.cn states verbatim: '计费方式：按照输入文本长度对应的 UTF-8 字节数进行计费' with a linked byte-counter tool (mothereff.in/byte-counter, confirmed to count bytes not characters). Caveat: the separate pricing page (siliconflow.cn/pricing) mislabels the same ¥0.05 rate's column header as '/千字符 UTF-8' ('per 1000 characters UTF-8') — an internal inconsistency in SiliconFlow's own materials; the more authoritative API-docs page + the byte-counter link resolve it in favor of bytes, matching the claim.

### [CONFIRMED] SiliconFlow ¥/min = 199 Chinese chars × 3 bytes/char = 597 bytes; 597/1000×0.05=¥0.0299/min

- **Evidence**：Arithmetic is correct given the stated 199 chars/min and 3 bytes/char (a Chinese character is indeed 3 bytes in UTF-8, confirmed empirically by ttsquality on a live 38-char string = 114 bytes). Caveat: ttsquality's live measurement of actual TTS narration speed found real output pace ≈333 billable chars/min at ≈2.45 bytes/char (tech text mixes in 1-byte ASCII), giving an empirically measured ≈¥0.0409/min — 37% higher than the 199-char-basis figure. This doesn't invalidate the requested recompute (which correctly uses the given 199-char basis) but is material context: real-world cost at typical narration speed is meaningfully higher than the 199-char figure across the board.

### [CONFIRMED] SiliconFlow sign-up bonus credit amount varies/not fixed in docs; 实名认证 required for preset/dynamic voices

- **Evidence**：Docs state '使用用户预置音色，需要进行实名认证' verbatim; no fixed bonus-credit amount found on docs or pricing pages (console-gated).

### [CONFIRMED] SiliconFlow stream=true gives genuine incremental streaming, not a fake flag

- **Evidence**：ttsquality ran both modes live: stream=true produced 72 chunked HTTP responses, first chunk at 389ms (128ms of audio); stream=false produced one blob at 1148ms. ~3x faster time-to-first-audio, genuinely incremental.

### [CONFIRMED] SiliconFlow protocol is OpenAI-compatible HTTP POST with Bearer token

- **Evidence**：ttsquality confirmed via direct use: POST https://api.siliconflow.cn/v1/audio/speech, Authorization: Bearer <key>.

### [CONFIRMED] SiliconFlow's CosyVoice2-0.5B has no quality-benchmark data; the CN-NewsTTS Bench score of 0.472 for cosyvoice-v3-plus is a different vendor/model and only a directional (negative) proxy, not a direct measurement

- **Evidence**：ttsbench confirmed 0 hits for 'CosyVoice2', 'FunAudioLLM' (as a tested system), or 'SiliconFlow'/'硅基' in the paper's full text; the 'Aliyun' entry tested is explicitly cosyvoice-v3-plus (DashScope), a different vendor/model/size than SiliconFlow's self-hosted CosyVoice2-0.5B. The claim's own hedging ('不能直接搬... 没有理由假设它比 v3-plus 好') is an accurate, appropriately cautious characterization.

### [CONFIRMED] MiniMax speech-2.8-hd = ¥3.5/万字符, speech-2.8-turbo = ¥2/万字符

- **Evidence**：Fetched platform.minimaxi.com/docs/guides/pricing-paygo.md directly: table row '同步语音合成 T2A | speech-2.8-hd | ... | 3.5' and '... | speech-2.8-turbo | ... | 2' (元/万字符), both for sync and async T2A.

### [CONFIRMED] MiniMax bills 1 Chinese character as 2 billing characters (English letters/digits/punctuation/space/newline = 1 each)

- **Evidence**：Doc footnote verbatim: '注：计费项是字符数，以10000个字符（输入）为单位，1个汉字算2个字符，英文字母、希腊字母、标点符号、特殊符号、空格、回车等算1个字符。' Exact match — this is the highest-risk claim in the set and it checks out precisely.

### [CONFIRMED] MiniMax ¥/min: speech-2.8-hd = 199×2/10000×3.5=¥0.139/min; speech-2.8-turbo = 398/10000×2=¥0.0796/min

- **Evidence**：Arithmetic matches exactly given the confirmed price and the confirmed 2x-Chinese-character billing rule.

### [CONFIRMED] MiniMax HD resource packs: 200万字符¥700(promo¥630)/1个月/RPM60/10 free clone voices; 2000万字符¥5950/3个月/RPM200; 2亿字符¥56000/1年/RPM500

- **Evidence**：Fetched platform.minimaxi.com/docs/guides/pricing-speech.md directly. HD table: 套餐一 ¥630(原¥700)/1个月/2,000,000字符/RPM60/送10个快速克隆音色 — exact match. 套餐二 ¥5,950(原¥7,000)/3个月/20,000,000字符/RPM200/送30音色 — exact match on the cited numbers (candidate omitted 原价 and voice count, not wrong). 套餐三 ¥56,000(原¥70,000)/1年/200,000,000字符/RPM500/送300音色 — exact match.

### [CONFIRMED] MiniMax voice design and fast voice cloning both cost ¥9.9/voice, charged only on first use

- **Evidence**：Doc rows for 音色设计(Voice Design) and 快速复刻(Voice Cloning) both state '9.9' 元/音色 with identical footnote: '调用本接口获得...音色时，不会立即收取...费用。...费用将在首次使用此音色进行语音合成时收取。'

### [CONFIRMED] MiniMax has no free trial tier listed for TTS on the pricing page

- **Evidence**：No occurrence of '免费' found on either pricing-paygo.md or docs/pricing/overview.md — only paid resource packs and pay-as-you-go pricing are listed.

### [CONFIRMED] MiniMax's bidirectional WebSocket streaming lets the client send text incrementally, but the server auto-batches by sentence rather than being fully incremental

- **Evidence**：Doc index description verbatim: '同步语音合成 WebSocket（双向流式）: 支持文本流式输入的 WebSocket 语音合成接口，客户端可逐字发送文本，由服务端自动攒句合成。' Exact match including the 'server auto-batches by sentence' characterization.

### [CONFIRMED] MiniMax quality: speech-2.8-hd strict accuracy 0.548 [.517,.579], coverage .850, rank #4 of 7; sports .000 (reads score hyphens as ranges), unit .542, military .448, brand .484

- **Evidence**：ttsbench read Table 5/7/8 of arXiv:2606.24714 directly: MiniMax .548 [.517,.579] Cov .850 rank #4 (behind Volcano/Azure/Google); category scores Sports .000/Unit .542/Mil. .448/Brand .484 all match exactly. Model config confirmed as speech-2.8-hd, voice 'Mandarin news'. Paper's own explanation for the 0.000 sports score matches the claim's framing (reads '96-91' as '九十六到九十一').

### [CONFIRMED] Alibaba Bailian's TTS lineup includes Qwen-Audio-TTS (tts-plus/-flash), CosyVoice (v3.5-plus/-flash, v3-plus/-flash, v2, v1), Qwen3-TTS family (flash+realtime, instruct-flash+realtime, vc, vd), Sambert (legacy), plus resold MiniMax/speech-2.8-hd

- **Evidence**：help.aliyun.com/zh/model-studio/tts-model fetched directly, confirms all named model codes present: qwen-audio-3.0-tts-plus, qwen-audio-3.0-tts-flash, cosyvoice-v3.5-plus, cosyvoice-v3.5-flash, cosyvoice-v3-plus, cosyvoice-v3-flash, cosyvoice-v2, cosyvoice-v1, qwen3-tts-flash(+realtime, dated snapshots), qwen3-tts-instruct-flash(+realtime), qwen3-tts-vc, qwen3-tts-vd(+realtime), and MiniMax/speech-2.8-hd as a resold option in a comparison table. Sambert not found on this specific page by my grep, but IS referenced on a sibling page (realtime-tts-user-guide): 'Qwen-Audio-TTS、CosyVoice 和 Sambert 在复用连接中的不同任务需要使用不同的 task_id' — confirms Sambert is a real, still-documented model family, though the specific 'official docs say don't use it for new projects' wording was not independently located.

### [CONFIRMED] Qwen-Audio-TTS/CosyVoice models share one model name across both WebSocket and HTTP; Qwen3-TTS family distinguishes via a '-realtime' suffix (WS) vs no suffix (HTTP)

- **Evidence**：help.aliyun.com/zh/model-studio/tts-model states verbatim: 'Qwen-Audio-TTS/CosyVoice 系列模型使用同一模型名称同时支持 WebSocket 和 HTTP 两种接入方式；Qwen 系列模型通过模型名称区分，带-realtime后缀的为 WebSocket 接入，不带后缀的为 HTTP 接入。'

### [CONFIRMED] DashScope WebSocket protocol uses run-task(streaming:duplex)→continue-task→task-finished/task-failed with task_id, auto-disconnects after 60s idle, different tasks need different task_ids, endpoint wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference

- **Evidence**：help.aliyun.com/zh/model-studio/realtime-tts-user-guide fetched directly: sample code literally sets 'dashscope.base_websocket_api_url=wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'; page contains 'run-task', 'task-finished', 'task_id' event names; verbatim '任务结束后 60 秒无新任务，连接自动断开' and 'Qwen-Audio-TTS、CosyVoice 和 Sambert 在复用连接中的不同任务需要使用不同的 task_id'.

### [CONFIRMED] Singapore and Beijing DashScope regions use different API keys

- **Evidence**：Same realtime-tts-user-guide sample code comment verbatim: '新加坡和北京地域的API Key不同。'

### [CONFIRMED] cosyvoice-v3-plus quality score of 0.472 (from CN-NewsTTS Bench v0.1) belongs to Aliyun's CosyVoice, not qwen-audio-3.0, and is the lowest-coverage system of the 7 tested

- **Evidence**：ttsbench: Table 5/7/8 give Aliyun (cosyvoice-v3-plus, voice longanyang) strict accuracy .472 [.441,.503], coverage .533 — the lowest of all 7 systems (Volcano .913 > Google .861 > MiniMax .850 > Azure .756 > MiMo .628 > AWS .570 > Aliyun .533); category scores Unit .021/Sports .134/Mil. .198/Brand .281 all match. 'qwen' has 0 hits anywhere in the paper, confirming the score cannot be attributed to qwen-audio-3.0.

