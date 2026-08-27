# Round 2 / 1 — Qwen3-TTS 复核

> 第二轮调研，2026-08-27 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度：qwen-tts

---

## Headline

价格基本持平（Qwen3 贵约 7%），但「延迟更低」没有任何适用于托管 API 的证据——97ms 是开源权重在 GPU 上的论文数字。值得换的理由是 51 个音色和方言/拟人化角色音，不是延迟。

## Verdict

不要以延迟为理由换。97 ms 出自 Qwen3-TTS 技术报告（arXiv 2601.15621，2026-01-22），测的是开源权重 Qwen3-TTS-12Hz-0.6B 在单卡开 torch.compile + CUDA Graph、并发为 1 时的首包（LM 93 ms + tokenizer 解码 4 ms），不含网络，也没有任何文档说托管的 qwen3-tts-flash 跑的就是这套 12Hz 权重——它的现役快照是 2025-11-27，比开源发布早两个月。阿里百炼自己的文档从头到尾没给过毫秒数，只写「首包延迟低」，并且明确提醒 SDK 量出来的首包延迟包含 WebSocket 建连耗时；两家都没有任何第三方实测，和上一轮的结论一样。价格上用户的判断方向对但幅度可忽略：qwen3-tts-flash 是 ¥0.8/万字符、汉字按 2 字符计，折合 ¥1.60/万汉字；硅基流动 CosyVoice2 是 ¥0.05/千 UTF-8 字节、汉字 3 字节，折合 ¥1.50/万汉字——按 250 字/分钟算是 ¥0.040 对 ¥0.0375 每分钟，一份两千字简报 ¥0.32 对 ¥0.30，一年差七块钱，不构成决策依据。真正的差别在别处：qwen3-tts-flash 有 51 个音色，含粤语、四川话、京片子、上海话、天津话、陕西话，以及萌宝、顽屁小孩、萌小姬这类拟人化角色音，而硅基流动的 CosyVoice2 只有八个通用播音音色；一旦砍掉插画角色，声音就是这个陪读者全部的人格载体，51 对 8 是实打实的差距。输出形态两边都能直喂 AVAudioPlayerNode：硅基流动直接给裸 PCM（8/16/24/32/44.1 kHz 可选），阿里 HTTP+SSE 给 base64 包着的 24 kHz/16-bit/单声道 PCM（不可选），Rust 侧多一层 SSE 帧解析和 base64 解码，几十行。建议的落法是：保持 docs/33 的架构和「按句接力」不变，把 qwen3-tts-flash 走 HTTP + `X-DashScope-SSE: enable` 做成第二个后端塞进同一个 Rust trait，在真机上把两家的按句 TTFB 一起量出来——这本来就是 docs/33「未实测」里挂着的唯一未知数，现在只是变成两个候选一起量。realtime WebSocket 那条路第一版不要走：贵 25%（¥1/万字符），换来的流式文本输入只有在 LLM token 边出边合成时才兑现，而 docs/33 明确把那个能力推后了，代价却是 Rust 侧一整套 5 个客户端事件 / 12 个服务端事件的会话协议加断线重连。

## Findings

### 2026-08 在售的 Qwen3-TTS 非实时模型是 qwen3-tts-flash（稳定版等同 2025-11-27 快照）和更新的 qwen3-tts-instruct-flash（等同 2026-01-26），另有 vd/vc 两个 2026-01 快照；qwen-tts / qwen-tts-latest 是按 Token 计费的老一代


计费页和限流页列出的完整快照：qwen3-tts-flash、qwen3-tts-flash-2025-11-27、qwen3-tts-flash-2025-09-18、qwen3-tts-instruct-flash、qwen3-tts-instruct-flash-2026-01-26、qwen3-tts-vd-2026-01-26、qwen3-tts-vc-2026-01-22；实时侧对应 qwen3-tts-flash-realtime、qwen3-tts-instruct-flash-realtime-2026-01-22、qwen3-tts-vd-realtime-2026-01-15、qwen3-tts-vc-realtime-2026-01-15。老一代 qwen-tts 系列仍在售但限流只有 10 RPM。文档没有把任何一个标成 preview/beta，全部按正式模型列在计费表里。

- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Date: 2026-08-27 抓取
- Confidence: high

### 97 ms 是 Qwen 技术报告里开源权重的模型侧数字，不是托管 API 的数字


arXiv 2601.15621 摘要原文："Qwen-TTS-Tokenizer-12Hz achieves extreme bitrate reduction and ultra-low-latency streaming, enabling immediate first-packet emission (97 ms)"。正文给的测法是 Qwen3-TTS-12Hz-0.6B、单卡、torch.compile + CUDA Graph、并发 1，拆开是 LM 首包 93 ms + tokenizer 解码 4 ms；12Hz-1.7B 是 101 ms，25Hz-0.6B 是 138 ms。不含网络往返，不含 TLS/WS 建连，不含排队。

- Source: https://arxiv.org/abs/2601.15621
- Date: 2026-01-22
- Confidence: high

### 阿里自己的托管文档从不公布延迟毫秒数，且明说测出来的首包延迟包含建连耗时


实时语音合成用户指南概述只写「支持流式输入与输出，首包延迟低」，全页没有任何 ms 数字。示例代码注释原文：「首次发送文本时需建立 WebSocket 连接，因此首包延迟会包含连接建立的耗时」，SDK 提供 get_first_package_delay() / getFirstPackageDelay() / get_first_audio_delay() 让你自己量。「语音合成模型选型」页也没有延迟栏。

- Source: https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide
- Date: 2026-08-27 抓取
- Confidence: high

### 负面结论：找不到任何第三方对 qwen3-tts-flash 或硅基流动 CosyVoice2 的可复现 TTFB 实测


Artificial Analysis 的 text-to-speech 榜只有 Characters Per Second（生成时长口径），没有 time-to-first-audio，也不收录 Qwen3-TTS、CosyVoice 或 SiliconFlow。中英文搜索都没捞到实测帖。上一轮研究的结论在 2026-08 仍然成立：不存在可引用的第三方 TTS TTFB 基准。

- Source: https://artificialanalysis.ai/text-to-speech
- Date: 2026-08-27 抓取
- Confidence: high

### qwen3-tts-flash 计费：¥0.8/万字符，输出不计费，汉字按 2 个字符计


计费规则原文「按输入文本的字符数计费，输出不计费」。字符计算规则原文：「一个汉字（包括简体汉字、繁体汉字、日文汉字和韩文汉字）计为 2 个字符。其他字符（如一个英文字母、一个数字、一个标点符号、一个空格）计为 1 个字符。使用 SSML 时，SSML 标签本身不计入字符数」。所以纯中文折合 ¥1.60/万汉字；ASCII 折合 ¥0.8/万字符，比硅基流动的 ¥0.05/千字节（即 ¥0.5/万 ASCII 字符）贵 60%。

- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Date: 2026-08-27 抓取
- Confidence: high

### realtime 版贵 25%：qwen3-tts-flash-realtime ¥1/万字符


北京地域 qwen3-tts-flash-realtime、qwen3-tts-instruct-flash-realtime、vd/vc-realtime 全部 ¥1/万字符，输出不计费。同族的非实时版全部 ¥0.8。老一代 qwen-tts-realtime 是 ¥2.4/百万输入 Token + ¥12/百万输出 Token。

- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Date: 2026-08-27 抓取
- Confidence: high

### 新加坡端点比北京便宜：qwen3-tts-flash ¥0.733924/万字符，realtime ¥0.954101/万字符，但没有免费额度


计费页「新加坡」分区明确标「服务部署范围：国际」。免费额度那一列只出现在华北2（北京）表里，页面原文「以下模型仅在华北 2（北京）地域下有免费额度，其他地域均无免费额度」。国际站接入点是 https://dashscope-intl.aliyuncs.com/api/v1，新加坡在售的 qwen3-tts 型号与北京基本一致。

- Source: https://www.alibabacloud.com/help/en/model-studio/qwen-tts
- Date: 2026-08-27 抓取
- Confidence: high

### 免费额度只有 1 万字符 / 90 天，等于约 5000 汉字，一份两千字简报能跑两三次


计费页原文「1 万字符」，有效期「自开通百炼/模型发布/申请通过之日起 90 天内（以较晚者为准）」。声音复刻 qwen-voice-enrollment 免费 1000 个音色/账号（之后 ¥0.01/音色），声音设计 qwen-voice-design 免费 10 个音色/账号（之后 ¥0.2/音色）。

- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Date: 2026-08-27 抓取
- Confidence: high

### HTTP + SSE 流式输出直接给 base64 编码的 24 kHz / 16-bit / 单声道 PCM，不需要解码步骤，但格式和采样率不可选


非实时指南原文：「流式模式下，音频数据以 Base64 编码的 PCM 格式逐段返回，最后一个数据包中包含完整音频的 URL」。官方 Python 示例用 rate=24000、np.int16 直接播；Java 示例写 AudioFormat.Encoding.PCM_SIGNED, 24000。开 SSE 只需加 header `X-DashScope-SSE: enable`。qwen3-tts-flash 的 HTTP 请求参数只有 model / input.text / input.voice / language_type（+instruct 系列的 instructions），没有 format 和 sample_rate——那两个字段只出现在 Qwen-Audio-TTS 和 CosyVoice 的请求里。非流式返回的是 24 kHz WAV 的 OSS URL，有效期 24 小时。

- Source: https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide
- Date: 2026-08-27 抓取
- Confidence: high

### realtime WebSocket 才有格式和语速控制：pcm/wav/mp3/opus，8000/16000/24000/48000 Hz，speech_rate 0.5–2.0


session.update 字段表：response_format 支持 pcm（默认）/wav/mp3/opus；sample_rate 支持 8000/16000/24000（默认）/48000；speech_rate 默认 1.0 范围 [0.5, 2.0]；volume 默认 50 范围 [0,100]；pitch_rate 默认 1.0 范围 [0.5,2.0]；bit_rate 仅 opus 可用。文档对每个参数都单独注明「千问-TTS-Realtime 不支持该参数」——那是老一代 qwen-tts-realtime，qwen3-tts-flash-realtime 不在该限制内。wss 端点：wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime，鉴权在握手阶段用 Authorization: Bearer。

- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-realtime-client-events
- Date: 2026-08-27 抓取
- Confidence: high

### 流式文本输入只有 realtime WebSocket 有；HTTP 那条路只有输出是流式的


WS 支持两种模式：server_commit「服务端智能判断文本分段与合成时机，客户端只需发送文本」，commit「客户端将文本添加至缓冲区后主动触发合成，适合精细控制断句的场景（如新闻播报）」。可以多次 input_text_buffer.append 再 commit，也就是能边收 LLM token 边喂、在句子说完之前就开始合成。HTTP 接口一次请求一整段文本，上限 600 字符（qwen-tts 系列是 512 Token）。

- Source: https://help.aliyun.com/zh/model-studio/interactive-process-of-qwen-tts-realtime-synthesis
- Date: 2026-08-27 抓取
- Confidence: high

### 负面结论：Qwen3-TTS 不返回任何时间戳、音素/口型或字幕对齐数据


服务端事件全集只有 session.created / session.updated / input_text_buffer.committed / input_text_buffer.cleared / response.created / response.output_item.added / response.output_item.done / response.content_part.added / response.content_part.done / response.audio.delta / response.audio.done / response.done / session.finished / error，没有任何带时间轴的事件。HTTP 响应对象里也只有 audio.url / audio.data / audio.id / audio.expires_at。唯一的计量字段是 usage.characters（计费字符数），可以用来对账。docs/33 现在的「按这一句共 N 字、总时长 T 线性插值」做法在两家上都得照做。

- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-realtime-server-events
- Date: 2026-08-27 抓取
- Confidence: high

### 音色 51 个，含 10 个中国方言音色和一批拟人化角色音——这是相对硅基流动八个播音音色的实质差距


方言：Jada（上海）、Dylan（北京）、Li（南京）、Marcus（陕西）、Roy（台湾腔）、Peter（天津）、Sunny 与 Eric（四川）、Rocky 与 Kiki（粤语）。角色化：Bella「萌宝」、Pip「顽屁小孩」、Bunny「萌小姬」（二次元）、Chelsie、Momo、Eldric Sage（智者长者）、Ryan（戏剧化）。另有西/俄/意/韩/日/德/法/葡语角色音。所有音色支持 10 种语言混说。

- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list
- Date: 2026-08-27 抓取
- Confidence: high

### 限流：qwen3-tts-flash 和 qwen3-tts-flash-realtime 都是 180 RPM，文档不给并发数上限


限流页对 Qwen3-TTS 系列只列「每分钟调用次数（RPM）」一列，qwen3-tts-flash = 180、qwen3-tts-flash-realtime = 180、instruct/vd/vc 同为 180；旧快照 2025-09-18 只有 10 RPM。同页对 CosyVoice 用的是「提交作业接口 RPS 限制 = 3」，对 qwen-tts 用的是 10 RPM + 100,000 TPM。全页不区分账户等级。180 RPM = 3 req/s，按句串行合成远远够用；但一份两千字简报切成八十来句就是八十来次请求，别并发爆发。

- Source: https://help.aliyun.com/zh/model-studio/rate-limit
- Date: 2026-08-27 抓取
- Confidence: high

### 输入要过阿里的「绿网」内容审核，命中就是 400 DataInspectionFailed，一句话直接没有音频


错误码页原文：「400 - DataInspectionFailed / data_inspection_failed，输入或者输出包含疑似敏感内容被绿网拦截，请修改输入内容后重试」。这是 DashScope 全平台的检查，不是某个模型的。对念新闻简报是真实风险：某一句被拦，那一句就是静音，需要在 Rust 侧把这个错误码单独识别并跳过/降级到本地 AVSpeechSynthesizer，而不是当网络错误重试。硅基流动是否做同类审核，其文档未说明。

- Source: https://help.aliyun.com/zh/model-studio/error-code
- Date: 2026-08-27 抓取
- Confidence: high

### 拿 API key 需要阿里云账号实名认证，不需要 ICP 备案


官方入门文档原文：「如果开通服务时提示『您尚未进行实名认证』，请先进行实名认证」。ICP 备案只针对在境内托管网站/域名，调 API 不涉及。北京端点是 dashscope.aliyuncs.com（境内直连，大陆设备不需要代理），新加坡是 dashscope-intl.aliyuncs.com。没有找到任何文档说个人账号不能用 qwen3-tts。

- Source: https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen
- Date: 2026-08-27 抓取
- Confidence: high

### 负面结论：百炼没有 OpenAI 兼容的 TTS 端点，换过去要新起一套凭据和客户端


OpenAI 兼容页里没有 audio/speech 相关内容，TTS 只走 DashScope 原生的 /api/v1/services/aigc/multimodal-generation/generation（HTTP）或 api-ws/v1/realtime（WS）。这意味着现在 src/ai/voice/config.ts 里 TTS 和 STT 共用 key + base_url 的做法在阿里这边不成立——要么新增一组 DashScope 凭据，要么整条语音链路都搬过去。

- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-api
- Date: 2026-08-27 抓取
- Confidence: medium

### 硅基流动至今只有两个付费 TTS 模型，都是 ¥0.05/千 UTF-8 字符，没有 CosyVoice3、IndexTTS 或 Fish


定价页「语音模型」区只有两个收费项：fnlp/MOSS-TTSD-v0.5 ¥0.05 和 FunAudioLLM/CosyVoice2-0.5B ¥0.05，单位标注为「输出价格（/千字符 UTF-8）」，文档侧写「按照输入文本长度对应的 UTF-8 字节数进行计费」。其余语音条目（XingChenASR 系列、Qwen3-ASR-1.7B、SenseVoiceSmall）全是 ASR 且免费。MOSS-TTSD-v0.5 是双人对话/播客向（零样本双人克隆、自动换说话人），不是单人播报的更快替代。

- Source: https://siliconflow.cn/pricing
- Date: 2026-08-27 抓取
- Confidence: high

### 阿里自家的 CosyVoice 和硅基流动托管的 CosyVoice2-0.5B 不是一回事，代次和价格都不同


百炼在售 cosyvoice-v3.5-plus ¥1.5、cosyvoice-v3.5-flash ¥0.8、cosyvoice-v3-plus ¥2、cosyvoice-v3-flash ¥1、cosyvoice-v2 ¥2、cosyvoice-v1 ¥2（均为每万字符，汉字算 2 字符）。v3.5 两个型号只在北京地域、且只支持声音复刻/声音设计，没有系统音色。硅基流动托管的是开源权重 CosyVoice2-0.5B，比百炼的 v3.5 落后两代。折算下来百炼 cosyvoice-v3.5-flash 和 qwen3-tts-flash 同价（¥1.6/万汉字），而 cosyvoice-v2 是它的 2.5 倍。

- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Date: 2026-08-27 抓取
- Confidence: high

### Qwen3-TTS 开源权重是 Apache-2.0（0.6B / 1.7B），但对 iOS 没有意义


GitHub QwenLM/Qwen3-TTS 2026-01-22 发布 Qwen3-TTS-12Hz-1.7B（VoiceDesign / CustomVoice / Base）、Qwen3-TTS-12Hz-0.6B（CustomVoice / Base）和 Qwen3-TTS-Tokenizer-12Hz，Apache-2.0，支持 3 秒声音克隆、单模型同时支持流式与非流式。97 ms 那个数字是在 GPU 上测的；iPhone 上跑 0.6B 自回归 TTS 不是 docs/33 那条链路能承受的，本地兜底仍然是 AVSpeechSynthesizer。

- Source: https://github.com/QwenLM/Qwen3-TTS
- Date: 2026-01-22
- Confidence: high

### qwen3-tts-flash 不支持 instructions；要情感/表现力控制得用 qwen3-tts-instruct-flash，同价


API 参数表原文：instructions「适用范围：该功能仅适用于千问 3-TTS-Instruct-Flash 系列模型」，最长 1600 Token，仅支持中英文；配套的 optimize_instructions 会把指令做语义增强重写。两者计费同为 ¥0.8/万字符、限流同为 180 RPM。另有 language_type 参数（Auto / Chinese / English / …），文档称「指定具体语种能显著提升合成质量，效果通常优于 Auto」——对中英混说的简报这条要实测取舍。

- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-api
- Date: 2026-08-27 抓取
- Confidence: high

### Qwen 官方博客对 Qwen3-TTS-Flash 的公开宣称里没有延迟数字，只有 WER 的相对比较


qwen.ai/blog?id=qwen3-tts-1128 对应 qwen3-tts-flash-2025-11-27，宣称 49+ 音色、10 种语言、9 种方言（普通话、闽南话、吴语、粤语、四川话、北京话、南京话、天津话、陕西话），并称在 MiniMax TTS 多语种测试集上平均 WER 低于 MiniMax、ElevenLabs 和 GPT-4o-Audio-Preview——没有给具体数值，属厂商自述。全文没有 ms 数字。

- Source: https://qwen.ai/blog?id=qwen3-tts-1128
- Date: 2025-12-05
- Confidence: medium

## Numbers

### qwen3-tts-flash 单价（北京）

- Value: ¥0.8 / 万字符（输入计费，输出不计费；汉字计 2 字符）
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### qwen3-tts-flash-realtime 单价（北京）

- Value: ¥1.0 / 万字符
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### qwen3-tts-flash 单价（新加坡国际）

- Value: ¥0.733924 / 万字符；realtime ¥0.954101 / 万字符
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### 硅基流动 FunAudioLLM/CosyVoice2-0.5B 单价

- Value: ¥0.05 / 千 UTF-8 字符（字节）
- Source: https://siliconflow.cn/pricing
- Vendor claim: no

### 折合每万汉字：Qwen3 对 CosyVoice2

- Value: ¥1.60 对 ¥1.50（Qwen3 贵 6.7%）
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### 每分钟普通话（250 汉字/分钟）成本

- Value: qwen3-tts-flash ¥0.0400；qwen3-tts-flash-realtime ¥0.0500；硅基流动 CosyVoice2 ¥0.0375
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### 一份 2000 汉字简报的成本

- Value: qwen3-tts-flash ¥0.32；realtime ¥0.40；硅基流动 ¥0.30（每天一份，一年 ¥117 / ¥146 / ¥110）
- Source: https://siliconflow.cn/pricing
- Vendor claim: no

### Qwen3-TTS 首包延迟（唯一存在的数字）

- Value: 97 ms（Qwen3-TTS-12Hz-0.6B，单卡 torch.compile + CUDA Graph，并发 1，LM 93 ms + tokenizer 4 ms，不含网络；12Hz-1.7B 101 ms，25Hz-0.6B 138 ms）
- Source: https://arxiv.org/abs/2601.15621
- Vendor claim: yes

### 托管 API 的首包延迟

- Value: 未公布，文档只写「首包延迟低」，并注明 SDK 测得值包含 WebSocket 建连耗时
- Source: https://help.aliyun.com/zh/model-studio/realtime-tts-user-guide
- Vendor claim: yes

### 限流

- Value: qwen3-tts-flash 与 qwen3-tts-flash-realtime 均 180 RPM（旧快照 2025-09-18 为 10 RPM）；并发数未文档化
- Source: https://help.aliyun.com/zh/model-studio/rate-limit
- Vendor claim: no

### 免费额度

- Value: 1 万字符，自开通/模型发布起 90 天内；仅华北2（北京）有，其他地域无
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### HTTP SSE 输出格式

- Value: base64 编码 PCM，24000 Hz / 16-bit / 单声道，不可选；非流式返回 24 kHz WAV 的 OSS URL（24 小时有效）
- Source: https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide
- Vendor claim: no

### realtime WS 输出格式

- Value: pcm（默认）/wav/mp3/opus；8000/16000/24000（默认）/48000 Hz；speech_rate [0.5,2.0]、volume [0,100]、pitch_rate [0.5,2.0]
- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-realtime-client-events
- Vendor claim: no

### 单次输入上限

- Value: 600 字符（qwen3-tts 系列）；512 Token（qwen-tts 老一代）；instructions 最长 1600 Token
- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-api
- Vendor claim: no

### 音色数量

- Value: qwen3-tts-flash 51 个（含 10 个中国方言音色、多个儿童/二次元角色音）对 硅基流动 CosyVoice2 的 8 个
- Source: https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list
- Vendor claim: no

### 声音复刻 / 声音设计价格

- Value: qwen-voice-enrollment ¥0.01/音色（免费 1000 个/账号）；qwen-voice-design ¥0.2/音色（免费 10 个/账号）
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

### 百炼自家 CosyVoice 价格（与硅基流动托管的开源 CosyVoice2 不是一回事）

- Value: cosyvoice-v3.5-flash ¥0.8、v3.5-plus ¥1.5、v3-flash ¥1、v3-plus ¥2、v2 ¥2、v1 ¥2，均每万字符
- Source: https://help.aliyun.com/zh/model-studio/billing-for-model-studio
- Vendor claim: no

## Fact-check

### Claim 1 — 2026-08在售Qwen3-TTS非实时模型是qwen3-tts-flash(=2025-11-27快照)和qwen3-tts-instruct-flash(=2026-01-26)，另有vd/vc两个2026-01快照；旧版qwen-tts按Token计费仍在售，限流10RPM；无任何模型标注preview/beta

- Verdict: **confirmed**

Evidence: 实抓 help.aliyun.com/zh/model-studio/billing-for-model-studio 原始HTML(2026-08-27)：千问3-TTS-Flash表内'qwen3-tts-flash 当前能力等同于qwen3-tts-flash-2025-11-27'；千问3-TTS-Instruct-Flash表内'qwen3-tts-instruct-flash 当前能力等同于qwen3-tts-instruct-flash-2026-01-26'；千问3-TTS-VD表仅一行qwen3-tts-vd-2026-01-26；千问3-TTS-VC表仅一行qwen3-tts-vc-2026-01-22；千问-TTS表列qwen-tts/qwen-tts-latest/qwen-tts-2025-05-22/qwen-tts-2025-04-10，计费规则'按输入Token和输出Token计费'。rate-limit页确认这四个老qwen-tts型号均为10RPM/100,000TPM，而qwen3-tts-flash/instruct-flash/vd/vc当前snapshot均180RPM(仅qwen3-tts-flash-2025-09-18和qwen3-tts-flash-realtime-2025-09-18两个旧快照是10RPM)。全文未检出'预览'/'beta'/'公测'字样。

### Claim 2 — 97ms是Qwen3-TTS开源权重模型侧数字非托管API数字；拆解为LM 93ms+tokenizer解码4ms(0.6B)，12Hz-1.7B为101ms，25Hz-0.6B为138ms，单卡/torch.compile+CUDA Graph/并发1

- Verdict: **confirmed**

Evidence: arXiv 2601.15621 HTML全文(arxiv.org/html/2601.15621) Table 2原文：'Qwen3-TTS-12Hz-0.6B 1 93 ms 4 ms 97 ms...' 'Qwen3-TTS-12Hz-1.7B 1 97 ms 4 ms 101 ms...' 'Qwen3-TTS-25Hz-0.6B 1 113 ms 25 ms 138 ms...'，三个数字与claim逐一精确吻合。正文原话：'latency is measured on our internal vLLM engine (vLLM V0 backend) on a single typical computational resource with optimizations applied via torch.compile and CUDA Graph...' 及 'Concurrency 1'列。论文摘要/正文明确这些是随权重一起以Apache 2.0发布的open-weight模型(Table 1列出的-Base/-VoiceDesign/-CustomVoice checkpoint)，不是DashScope托管API。唯一细微出入：论文原话是'a single typical computational resource'而非明说'单卡GPU'，但结合vLLM+CUDA Graph语境这就是单张GPU，不构成实质性错误。

### Claim 3 — 阿里托管文档从不公布延迟毫秒数，realtime-tts-user-guide全页没有任何ms数字，只写'首包延迟低'，并注明首包延迟含WebSocket建连耗时

- Verdict: **corrected**

Correction: 该页确实有一个ms数字：FAQ排查小节'Q：语音合成耗时较长是什么原因？'下明确写着'首包延迟：正常约500ms'，用作性能异常排查的参考基线。'全页没有任何ms数字'这句不成立。其余表述（概述页写'首包延迟低'无数字、WS建连耗时会计入首包延迟、SDK提供get_first_package_delay()/getFirstPackageDelay()/get_first_audio_delay()三个方法）经核对均准确。

Evidence: 实抓 help.aliyun.com/zh/model-studio/realtime-tts-user-guide 原始HTML(2026-08-27)。概述段原文：'支持流式输入与输出，首包延迟低'，全页无ms数字——除了FAQ段：'Q：语音合成耗时较长是什么原因？...分析性能指标 首包延迟：正常约500ms。RTF（实时率=合成总耗时/音频时长）：正常应小于1.0。' 代码注释原文匹配：'首次发送文本时需建立WebSocket连接，因此首包延迟会包含连接建立的耗时'。三个SDK方法名get_first_package_delay/getFirstPackageDelay/get_first_audio_delay均在页面中出现。

### Claim 4 — Artificial Analysis的TTS榜只有CPS指标无TTFB，且不收录Qwen3-TTS、CosyVoice或SiliconFlow，故不存在可引用的第三方TTS TTFB基准

- Verdict: **corrected**

Correction: AA确实不提供TTFB/time-to-first-audio指标（只有Characters Per Second等生成时长口径），这部分成立。但'不收录Qwen3-TTS、CosyVoice或SiliconFlow'是错的：该页JSON数据里明确列有model family'CosyVoice TTS'(slug cosyvoice-tts)、模型'Qwen-Audio-3.0-TTS-Plus'与'Qwen3-TTS-VC-Realtime'（经DeepInfra托管，qualityElo=927.49，release 2026-01-22，属于'Qwen'model family），以及host'SiliconFlow'(slug siliconflow)。这是三选一/或有一处成立、一处不成立——性质上是把析取误判成了不存在，结论方向('没有TTFB基准')仍大体站得住，但支撑证据('AA不收录')是假的。

Evidence: 实抓 artificialanalysis.ai/text-to-speech 原始HTML(2026-08-27)。JSON片段：'{"id":"...","name":"CosyVoice TTS","slug":"cosyvoice-tts","url":"/text-to-speech/model-families/cosyvoice-tts"}'；'{"name":"Qwen3 TTS, DeepInfra"..."shortName":"Qwen3-TTS-VC-Realtime","slug":"qwen3-tts-vc-realtime"..."qualityElo":927.49,"releaseDate":"2026-01-22"..."creator":{"name":"Alibaba"}..."family":{"name":"Qwen","slug":"qwen"}..."host":{"name":"DeepInfra"}}'；'{"slug":"siliconflow","name":"SiliconFlow"}'。全文搜索'ttfb'/'time to first'/'latency'均0命中，证实无TTFB指标这一半成立。

### Claim 5 — qwen3-tts-flash计费¥0.8/万字符，输出不计费，汉字计2字符，纯中文折合¥1.60/万汉字，比硅基流动CosyVoice2(¥0.5/万ASCII字符)贵60%

- Verdict: **confirmed**

Evidence: 实抓billing-for-model-studio原文：千问3-TTS-Flash '计费规则：按输入文本的字符数计费，输出不计费' 'qwen3-tts-flash 0.8元 不计费'。字符计算规则原文：'一个汉字（包括简体汉字、繁体汉字、日文汉字和韩文汉字）计为2个字符。其他字符...计为1个字符。使用SSML时，SSML标签本身不计入字符数'——与claim逐字一致。硅基流动CosyVoice2定价JSON确认'price':'50','priceUnit':'/ M UTF-8 bytes'即¥0.05/千字节；ASCII下¥0.05/千字节=¥0.5/万字符，0.8/0.5=1.6即贵60%，算术核验无误。

### Claim 6 — realtime版贵25%：qwen3-tts-flash-realtime北京¥1/万字符 vs 非实时¥0.8；老一代qwen-tts-realtime是¥2.4/百万输入Token+¥12/百万输出Token

- Verdict: **confirmed**

Evidence: 实抓billing-for-model-studio原文：Qwen3-TTS-Flash-Realtime华北2表'qwen3-tts-flash-realtime 1元 不计费'，同族非实时版均0.8元(1/0.8=1.25，贵25%)；VD/VC/Instruct-Flash-Realtime同样均1元。千问-TTS-Realtime(老一代)表原文：'qwen-tts-realtime 2.4元 12元 100万Token'，与claim精确一致。

### Claim 7 — 新加坡/国际端点比北京便宜：qwen3-tts-flash ¥0.733924/万字符、realtime ¥0.954101/万字符，无免费额度；国际站接入点https://dashscope-intl.aliyuncs.com/api/v1；引用URL为alibabacloud.com/help/en/model-studio/qwen-tts

- Verdict: **corrected**

Correction: 数字和结论本身全部核实无误，但引用的URL(alibabacloud.com/help/en/model-studio/qwen-tts)是一篇纯用法/代码示例指南，全文不含任何计费数字、不含'服务部署范围：国际'字样，只在代码注释里出现过Singapore区的base_http_api_url。真正给出¥0.733924/¥0.954101这些数字、以及'新加坡'表头下'服务部署范围：国际'标注、以及'仅华北2(北京)有免费额度'说明的，是help.aliyun.com/zh/model-studio/billing-for-model-studio这同一张计费页——即claim 1/5/6已经引用的那个URL。应改引这个URL，而不是英文用法指南页。

Evidence: 实抓billing-for-model-studio原文，'新加坡'标题下的千问3-TTS-Flash表：'qwen3-tts-flash 国际 0.733924元 qwen3-tts-flash-2025-11-27 国际 0.733924元 qwen3-tts-flash-2025-09-18 国际 0.733924元'；千问3-TTS-Flash-Realtime同区表：'国际 0.954101元'（三个snapshot均同价）。该'新加坡'区块下的表格只有'服务部署范围/输入单价'两列，没有'免费额度'列，而华北2(北京)表明确写'说明：以下模型仅在华北2（北京）地域下有免费额度，其他地域均无免费额度'。实抓alibabacloud.com/help/en/model-studio/qwen-tts原文只搜到14处'Singapore'均在代码注释里（如'# The following is the configuration for the Singapore region. dashscope.base_http_api_url = "https://dashscope-intl.aliyuncs.com/api/v1"'），无'0.733924'、无'pricing'/'billing'字样，证实该页不含被引用的计费数字。

### N1 — qwen3-tts-flash单价(北京)=¥0.8/万字符，输入计费输出不计费，汉字计2字符

- Verdict: **confirmed**

Evidence: 同Claim 5核实结果，billing-for-model-studio原文'qwen3-tts-flash 0.8元 不计费'。

### N2 — qwen3-tts-flash-realtime单价(北京)=¥1.0/万字符

- Verdict: **confirmed**

Evidence: 同Claim 6核实结果，billing-for-model-studio原文'qwen3-tts-flash-realtime 1元 不计费'。

### N3 — qwen3-tts-flash单价(新加坡国际)=¥0.733924/万字符；realtime ¥0.954101/万字符

- Verdict: **confirmed**

Evidence: 同Claim 7核实结果，billing-for-model-studio '新加坡'区块原文分别为'国际 0.733924元'和'国际 0.954101元'。此条自身引用的URL(billing-for-model-studio)是对的，问题只出在Claim 7正文另引了一个不含该数据的英文页。

### N4 — 硅基流动CosyVoice2-0.5B单价=¥0.05/千UTF-8字符（即字节）

- Verdict: **confirmed**

Evidence: 实抓siliconflow.cn/pricing页内嵌JSON：'"modelId":"17885302679","modelName":"FunAudioLLM/CosyVoice2-0.5B"..."price":"50","currency":"¥"..."priceUnit":"/ M UTF-8 bytes"'，即¥50/百万字节=¥0.05/千字节。附带发现：该页面可见的列标题写的是'输出价格（/千字符UTF-8）'（用'字符'而非'字节'），与底层priceUnit元数据'bytes'字样自相矛盾，是硅基流动自己页面的标注不一致，但claim括注的'(即字节)'与底层计费口径(bytes)相符，数值本身无误。

### N5 — 折合每万汉字：Qwen3对CosyVoice2=¥1.60对¥1.50（Qwen3贵6.7%）

- Verdict: **confirmed**

Evidence: 算术复核：Qwen3=10000汉字×2字符/字÷10000×0.8=¥1.60；CosyVoice2=10000汉字×3字节/字(UTF-8)÷1000×0.05=¥1.50；1.60/1.50-1=6.67%，与claim一致，基于N1/N4已核实单价。

### N6 — 每分钟普通话(250汉字/分钟)成本：qwen3-tts-flash¥0.0400；realtime¥0.0500；CosyVoice2¥0.0375

- Verdict: **confirmed**

Evidence: 算术复核：250×2/10000×0.8=0.04；250×2/10000×1.0=0.05；250×3/1000×0.05=0.0375，三者均与claim一致。

### N7 — 2000汉字简报成本：qwen3-tts-flash¥0.32、realtime¥0.40、CosyVoice2¥0.30，年成本(365天)¥117/¥146/¥110

- Verdict: **confirmed**

Evidence: 算术复核：2000×2/10000×0.8=0.32；×1.0=0.40；2000×3/1000×0.05=0.30。年化：0.32×365=116.8≈117；0.40×365=146；0.30×365=109.5≈110，均与claim吻合。

### N8 — Qwen3-TTS首包延迟(唯一存在的数字)=97ms(12Hz-0.6B单卡torch.compile+CUDA Graph并发1，LM 93ms+tokenizer 4ms，不含网络；12Hz-1.7B为101ms，25Hz-0.6B为138ms)

- Verdict: **confirmed**

Evidence: 同Claim 2，arXiv 2601.15621 Table 2原始数据逐项核对无误。

### N9 — 托管API首包延迟未公布，文档只写'首包延迟低'，SDK测得值含WebSocket建连耗时

- Verdict: **corrected**

Correction: 未公布这个说法不准确：realtime-tts-user-guide的FAQ排查段落里公布了一个参考数字——'首包延迟：正常约500ms'。这不是正式SLA/规格表里的数字，而是排查'合成耗时较长'问题时给出的经验基线，但它确实是一个已发布的托管API延迟ms数字，claim说'未公布'不成立。WebSocket建连耗时会计入首包延迟这条本身准确。

Evidence: 同Claim 3，实抓realtime-tts-user-guide原文FAQ段：'Q：语音合成耗时较长是什么原因？...首包延迟：正常约500ms。'

### N10 — 限流：qwen3-tts-flash与qwen3-tts-flash-realtime均180RPM(旧快照2025-09-18为10RPM)；并发数未文档化

- Verdict: **confirmed**

Evidence: 实抓help.aliyun.com/zh/model-studio/rate-limit原文：'Qwen3-TTS-Flash...qwen3-tts-flash 180 qwen3-tts-flash-2025-11-27 180 qwen3-tts-flash-2025-09-18 10'；'Qwen3-TTS-Flash-Realtime...qwen3-tts-flash-realtime 180 qwen3-tts-flash-realtime-2025-11-27 180 qwen3-tts-flash-realtime-2025-09-18 10'。全页里'并发数'/'同时处理中任务数量'字段只出现在图像/视频生成类模型的限流表中，TTS(千问-TTS系列)表内完全没有这一列，证实并发数确实未文档化。

### N11 — 免费额度=1万字符，自开通/模型发布起90天内；仅华北2(北京)有，其他地域均无

- Verdict: **confirmed**

Evidence: 实抓billing-for-model-studio原文：'以下模型仅在华北2（北京）地域下有免费额度，其他地域均无免费额度'，且免费额度列注释原文为'有效期：自开通百炼/模型发布/申请通过之日起90天内（以较晚者为准）'——比claim多一个'申请通过'触发条件及'以较晚者为准'的细节，但claim的简化表述不构成事实错误。qwen3-tts-flash/instruct-flash/vd/vc/realtime系列免费额度均为'1万字符'，与claim一致。

### N12 — HTTP SSE输出=base64编码PCM，24000Hz/16-bit/单声道，不可选；非流式返回24kHz WAV的OSS URL(24小时有效)

- Verdict: **confirmed**

Evidence: 实抓non-realtime-tts-user-guide原文：'流式模式下，音频数据以Base64编码的PCM格式逐段返回，最后一个数据包中包含完整音频的URL'；Java播放示例中AudioFormat硬编码为'24000,//采样率 16,//采样位数 1,//声道数'，注释写'需与API返回格式一致'。关键佐证'不可选'：qwen3-tts-flash自己的请求示例(Python/Java)完全没有format/sample_rate参数，而同页里qwen-audio-3.0-tts-flash和cosyvoice-v3-flash的示例都显式带有'"format":"wav","sample_rate":24000'这类可调参数——说明Qwen-TTS(qwen3-tts-flash)这一档确实没开放该参数，与'不可选'的判断一致。非流式段原文：'非流式模式下，响应中包含url字段，指向合成的音频文件。URL有效期为24小时'，与claim一致。

## Risks

- 绿网内容审核会让一句话直接没有音频：400 DataInspectionFailed 是 DashScope 全平台的输入/输出敏感内容拦截。念新闻简报天然踩这个雷，Rust 侧必须把这个错误码和网络错误分开处理（跳过或降级到 AVSpeechSynthesizer），否则会变成静音重试循环。
- 把 97 ms 当成端到端延迟写进设计文档。它是 GPU 上、并发 1、不含网络的模型侧数字，而且没有任何文档说托管的 qwen3-tts-flash（2025-11-27 快照）跑的就是那套 2026-01 才开源的 12Hz 权重。真机上的按句 TTFB 只会是它的若干倍。
- 换供应商会打断现在 TTS 和 STT 共用 key + base_url 的做法：百炼没有 OpenAI 兼容的 TTS 端点，得单独接一套 DashScope 凭据和客户端。
- realtime WebSocket 在 Rust 侧是一整套会话协议（4 个客户端事件、14 个服务端事件、session 生命周期、断线重连、keepalive），换来的流式文本输入在 docs/33 的第一版里用不上，还贵 25%。
- 别把模型 id 写死成带日期的旧快照：qwen3-tts-flash-2025-09-18 的限流只有 10 RPM，是现役 180 RPM 的十八分之一。用不带日期的稳定别名。
- 新加坡端点单价更低（¥0.733924）但没有免费额度，且从大陆设备访问要跨境，延迟劣势可能吃掉一切；不要为了省 8% 单价把请求发去新加坡。
- 硅基流动是否对 TTS 输入做内容审核完全没有文档，现在没踩到不等于不存在。这一条对两家都是未知，不是硅基流动的优势。

## Open questions

- 托管的 qwen3-tts-flash 用的到底是不是技术报告里那套 12Hz tokenizer 的权重？稳定快照日期（2025-11-27）早于开源发布（2026-01-22），文档没说，只能靠实测反推。
- 两家从大陆 iPhone 真机、按句（20 字左右）请求的实际 TTFB 分别是多少？这是 docs/33「未实测」里挂着的唯一未知数，现在变成两个候选一起量。量的时候要分开记 DNS+TLS、首字节、首个可播 PCM 帧三段。
- qwen3-tts-flash 的 HTTP SSE 首个 chunk 里的 PCM 片段有多长？如果服务端按整句缓冲后一次性吐，SSE 的「流式」对首字延迟就没有帮助，那 realtime WS 的价值会重新变高。
- instructions（qwen3-tts-instruct-flash，同价）对简报播报的实际收益有多大？1600 Token 的指令要不要每句都带，带了会不会影响首包延迟。
- realtime WebSocket 会话最长能挂多久、单账号能开几条并发连接——文档两项都没写。简报播报要挂十几分钟，这个必须问清或实测。
- language_type 指定 Chinese 对中英混说的简报是变好还是变差？文档说指定语种「效果通常优于 Auto」，但我们的文本里必然混着 GPT-5、arXiv 这类英文专名。
- 51 个音色里哪一个适合做「没有脸的发光块」的声音？这件事只能听，不能查——官方 demo 页试听一轮再定，别按名字挑。
