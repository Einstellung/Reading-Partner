# 级联语音：开源框架和提速手段调研

调研日期 2026-10-14，只查资料没跑。凡标「厂商」的数字都是自报，没有第三方复现。仓库活跃度和许可证是当天 `gh api repos/...` 取的。

## 我们现在在哪

按仓库里的现值估（不是实测整链）：能量 VAD 判停 `hangoverMs: 1250`（`src/soul/voice/turn-detect.ts:118`）→ SpeechAnalyzer 出 final（收尾时长没人公布）→ Claude 首 token（Sonnet 4.6 P50 850 / Sonnet 5 P50 1204 ms，见下）→ mimo 首音 iPhone p50 628 ms + 句首静音 117 ms（docs/33，2026-09-05 真机）。合计约 3–3.5 s，业界做得好的级联是 0.8–1.3 s。差距最大的两段是判停（多约 1 s）和 TTS 首包（多约 0.5 s）。打断用 -35 dBFS 能量门限、回复开头 2 s 免疫窗（同文件 `immunityMs: 2000`），嘈杂环境下噪声直接过门限。

## 框架对比

| 框架 | 架构 / 传输 | iOS 客户端 | 要不要服务器 | 许可证 | 活跃度（2026-10-14） |
|---|---|---|---|---|---|
| Pipecat | Python 帧管线，服务端跑 STT→LLM→TTS；WebRTC（Daily / SmallWebRTC）或 WebSocket | `pipecat-client-ios`（Swift，SPM，RTVI 协议；26 星，最后推送 2026-07-02）；JS 客户端可进 WKWebView | 要，Python 进程或 Pipecat Cloud | BSD-2-Clause | 16.4k 星，v1.12.0（2026-09-26），4 月发 1.0 |
| Smart Turn（Pipecat 出） | 音频进、完成/未完成二分类，配 Silero VAD 用 | 社区有 CoreML 转换 16.8 MB | 不要，可端侧 | BSD-2-Clause | v3.2，最后推送 2026-01-29 |
| LiveKit Agents | Python/Node agent worker 进 LiveKit 房间，WebRTC | `client-sdk-swift` 2.17.0（2026-09-14） | 要，LiveKit server（可自建，Apache）+ worker | 代码 Apache-2.0；turn detector 权重是 LiveKit Model License，**只许在 LiveKit Agents 里用**；自适应打断模型不开放权重，自建每月 4 万次免费推理后退回 VAD | 14.7k 星，1.8.7（当天） |
| TEN Framework（声网） | 扩展图 + Go API server，Agora RTC 为主，也支持 WebSocket | 走 Agora RTC SDK | 要，Docker，且要 Agora 账号 | Apache-2.0 **加附加条款**：不得与声网竞争；TEN Turn Detection 明文禁止部署在终端设备（含手机） | 11.2k 星，0.11.73（2026-09-22） |
| Vocode | 电话为主的 Python 管线 | 无 | 要 | MIT | 停更：最后推送 2024-11-15 |
| Bolna | 电话外呼编排，WebSocket + Twilio/Plivo | 无 | 要，Docker + Redis | MIT（托管 API 闭源） | 791 星，当天还在发版；README 自称在找维护者 |
| OpenAI Agents SDK `VoicePipeline` | Python，STT→agent→TTS，默认 OpenAI 语音模型 | 无 | 要 | MIT | v0.23.1（2026-10-02）；文档明说流式输入**没有内建打断** |
| FastRTC（Gradio） | Python，WebRTC / WebSocket，自带 VAD 和轮次 | 浏览器 WebRTC，可进 WKWebView | 要 | MIT | 停滞：0.0.34（2025-11-24），最后推送 2026-01-12 |
| Ultravox | 语音进文本出的语音 LLM（Whisper 编码器 + 文本 LLM） | 无，托管 API 或自部署 | 要，v0.7 骨干是 GLM-4.6 355B | 权重 MIT | v0.6 最后发版 2025-08；v0.7 2025-12 |

2026 年没有冒出新的主流开源框架，Pipecat 和 LiveKit 是两强。新东西在模型和论文层：LiveKit Turn Detector v1（2026-06，音频+语义双分支）、LiveKit 自适应打断（2026-03）、Krisp VIVA 的打断预测和轮次预测（商用）、RelayS2S（arXiv 2603.23346）、Voice-Light（2026-09）。

对我们：所有框架都要一台服务器把三段串起来，而我们是端上直连各家 API，搬进任何框架都是重做架构。许可证上能直接拿来用的只有 Smart Turn（BSD-2）、Silero VAD（MIT）和 Pipecat 的源码思路；LiveKit 的两个模型和 TEN 的轮次模型都用不了。Ultravox 吃音频吐的是回答，接在前面就等于把脑子换掉，不适合我们。

## 延迟预算

| 段 | Pipecat 指南参考值 | 业界区间 | 我们（估） |
|---|---|---|---|
| 采集、编码、网络、抖动缓冲（上行） | 114 ms | 30–100 | 端上采集，几乎为 0 |
| 判停 + ASR 收尾 | 300 | 200–400（模型判停）；纯静音阈值 800+ | 1250 + final 延迟 |
| LLM 首 token | 650 | 300–700 | 850–1200（Sonnet），开思考更长 |
| 句子聚合 | 20 | — | 等整句 |
| TTS 首包 | 120 | 80–200（模型侧）；含网络 160–300 | 628 + 117 静音 |
| 下行 + 播放 | 89 | — | 端上播放 |
| **合计** | **1293** | 目标 ≤1500，好的 800–1200 | 约 3000–3500 |

Pipecat 列来自 voiceaiandvoiceagents.com（Kwindla Kramer，2026-06 更新），它定 1500 ms 为目标、1200 可达。LLM 首 token 按 Pipecat Voice readiness 基准（2026-08-18，P50/P95，TTFAT 不含推理）：claude-haiku-4-5 637/1615、claude-sonnet-4-6 850/4126、claude-sonnet-5 1204/2465、claude-fable-5 3956/6496；它定 700 ms 为上限，Claude 里只有 Haiku 4.5 进线。ASR 收尾按 Pipecat STT 基准（2026-09，英文 1000 句，从 VAD 停到 final）：Nemotron 221、Deepgram nova-3 247、Soniox v4 249、AssemblyAI 282、Speechmatics 369 ms（中位）。分段区间来自 futureagi、simbavoice、twig 等 2026 年博客。

## 轮次判断

| 模型 | 输入 | 体积 | 速度 | 中文 | 端侧 | 许可 |
|---|---|---|---|---|---|---|
| Smart Turn v3.x | 音频，最长 8 s，16 kHz | 8M 参数；int8 8 MB / fp32 32 MB；CoreML 16.8 MB | CPU 9–57 ms（AWS 各档）；CoreML 在 M5 Pro 3.5 ms | 23 语种含中文，但中文准确率没公布（英 94.7–95.6%、西 90–91%） | 能 | BSD-2 |
| LiveKit 文本版（旧） | STT 文本，128 token | Qwen2.5-0.5B，约 400 MB | 25–160 ms | 14 语种含中文 | 理论能 | 只限 LiveKit Agents |
| LiveKit v1 / v1-mini（2026-06） | 音频，语义+声学双分支 | 未公布 | 300 ms 预算下误切 9.9%（Deepgram Flux 12.9%） | 14 语种，未点名中文 | v1 只在云；v1-mini 开权重 | 同上 |
| TEN Turn Detection | 文本，三分类 finished / unfinished / wait | Qwen2.5-7B | 未公布 | 中英，中文 finished 98.9% / unfinished 92.7%（自测） | 不能，且许可禁止 | Apache + 附加条款 |
| Soniox / Deepgram Flux | ASR 内建判停 | 云 | Flux 中位 <300 ms | Soniox 有中文 | 否 | 商用 |

做法都是同一个套路：VAD 用很短的静音（Pipecat 默认 0.2 s）触发一次模型判断，判「完」就走，判「未完」继续等；静音超过兜底（Smart Turn 默认 3 s）强制算完。相比纯静音阈值，判停从 800+ ms 降到 200–400 ms（Twig）。抢话方面，LiveKit 文本版比纯 VAD 少 39% 的误打断（厂商，旧版）。Pipecat 指南另加第三层：LLM 输出首个 token 标记「现在答 / 等 5 s / 等 10 s」，在送 TTS 前剥掉。

中文的坑：Smart Turn 没给中文分项；我们的场景是边读边想，停顿比客服电话长。上线前要拿自己的中文录音量一遍。

## 打断和附和

- 区分真打断和「嗯」「对」有两条路。一是模型：LiveKit 自适应打断看语音开头几百毫秒的波形、起音、时长、韵律，86% 精度、100% 召回、挡掉 51% 的 VAD 误打断、中位 216 ms 判定（厂商，2026-03-19，仅云）；Krisp VIVA 打断预测同类（商用，Pipecat 有接入）。二是规则：Pipecat `MinWordsUserTurnStartStrategy(min_words=3)`，说够 3 个词才算打断；AssemblyAI 文档同样建议按转写长度加附和词表过滤。中文按字数加「嗯/对/好/是/哦」词表即可。
- 回声：iOS 只有 VPIO（`setVoiceProcessingEnabled`）真做 AEC，且播放必须走同一个 VPIO unit；收敛需要一小段时间，开头会漏回声（Apple 论坛）。我们已经有 VPIO 和 2 s 免疫窗。Pipecat 的兜底是 `AlwaysUserMuteStrategy`（机器说话时干脆不听）。
- 截断上下文：Pipecat 把 TTS 文本帧和播放同步推进，打断时只把已播出的部分提交成助手消息，未播出的丢掉；用 TTS 的字级时间戳对齐（Pipecat 文档、Kwindla 指南）。打断后要取消在飞的 LLM、TTS 并清空播放缓冲。

## 让级联「感觉快」的手段

| 手段 | 做法 | 数字 | 出处 |
|---|---|---|---|
| 投机启动 LLM | 判停「可能完了」就发请求，用户接着说就撤 | Deepgram Flux EagerEndOfTurn：中位省约 150 ms，尾部 5% 省约 350 ms（Telnyx，2026-01）；LiveKit preemptive generation：p95 省 200–400 ms（第三方估）；FIT-Voice 用轮次预测投机，1.2→0.8 s（-33%） | Deepgram 文档、Telnyx 发布说明、LiveKit 文档、FIT 2026 论文 |
| 流式 ASR 部分结果提前送 | 边说边转写，判停时只剩最后一段要收尾 | Pipecat STT 基准 final 220–390 ms；SpeechAnalyzer 首个 volatile 0.3–0.5 s（iPhone 16e，iOS 26.5，单篇博客） | 同上表 |
| 填充语 / 快慢双模型 | 主模型首 token 超时就让小模型说一句垫话，主回答缓冲后接上 | ConvFill（360M 端侧模型垫话）：Claude Sonnet 4.5 首 token 2.16 s → 0.17 s，QA 准确率 46–52%（后端单跑 69–80%）；Inworld 示例超时 1200 ms、垫话最多 12 token | arXiv 2511.07397、Inworld 文档 |
| 首句快模型、后续强模型 | 快通道先说短前缀，慢通道接续，校验器决定留不留前缀 | 无统一数字 | RelayS2S arXiv 2603.23346、Dual-Track arXiv 2602.23266 |
| TTS 首包 | 首句切短（到第一个逗号），文本流式输入 TTS，连接池保活 | 我们实测：同 client 连发首帧 355–515 ms，每句新建 536–754 ms（docs/33） | docs/33 |
| 预热连接 | 用户一开口就建好 LLM 和 TTS 的连接；agent 进程预热池 | 省一次 TLS 握手，国内到海外 0.5–0.9 s（docs/research/TTS供应商横评） | Kwindla 指南、LiveKit 社区 |
| Prompt cache | 固定前缀（系统提示、书的上下文）放前面缓存，动态内容放后面 | 受控研究：首 token 快 13–31%（arXiv 2601.06007）；AWS 对 Claude 称最多 85% | 同左 |
| 不开思考、选低 TTFT 模型 | 语音回合走无思考、首 token 快的档 | Haiku 4.5 637 vs Sonnet 5 1204 vs Fable 5 3956 ms | Pipecat voice-readiness |

## 流式 ASR 和 TTS 补两个维度

ASR（中文、首包快）：Soniox 有中文，厂商称 <200 ms、用模型判停不用 VAD、约 $0.12/小时；阿里 Fun-ASR-Realtime / qwen3-asr-flash-realtime 是 WebSocket 流式、服务端 VAD 或手动 commit，首字延迟官方没给数；火山大模型流式识别官方也没给数。SpeechAnalyzer 本地、免费、无网络，但 final 收尾时长没人公布、没有热词。英文榜见上面 Pipecat 基准，没有中文榜。

| TTS | 首包 | 流式输入文本 |
|---|---|---|
| 小米 mimo-v2.5-tts（现役） | iPhone 实测 p50 628 ms + 117 ms 句首静音 | 不支持，整句放进 assistant 消息 |
| 阿里 qwen3-tts-flash | 桌面实测 471 ms | HTTP 不支持；`qwen3-tts-*-realtime` 另一套 session 协议支持追加文本 |
| Qwen3-TTS 开源模型 | 论文 97 ms（0.6B）/ 101 ms（1.7B），模型侧 | 支持，一个字就能出首包 |
| 阿里 CosyVoice WebSocket | 未公布 | 支持，同会话分批送，服务端自己断句 |
| 火山 seed-tts 2.0 | 未公布（旧 bigtts 称约 600 ms） | WebSocket 双向流式有，粒度未公布 |
| 讯飞超拟人 | 未公布 | 支持，真双向流式 |
| Cartesia Sonic-3 | 模型侧约 90 ms；含网络中位 166 ms（Vapi 测） | 支持（continuations），国内要过境外 |
| ElevenLabs Flash v2.5 | 模型侧 75 ms（不含网络） | 支持（multi-stream-input WebSocket），国内要过境外 |

## 判断：最该先补的 3 件事

1. 判停换掉能量 VAD 加 1250 ms 静音。改成 Silero VAD（MIT，抗噪远好于能量门限）短静音 200–300 ms 触发，端上跑 Smart Turn v3.2（CoreML 16.8 MB，毫秒级），判「未完」再等，兜底 2–3 s。预计省 0.8–1 s，同时解决嘈杂环境误触发。先用我们自己的中文朗读和讨论录音量误切率，阈值按读书场景调松。
2. 首声路径全部并行。用户开口就预热 Anthropic 和 TTS 连接；Smart Turn 判「可能完」就用 SpeechAnalyzer 当前文本投机发 Claude 请求，用户续说就撤；书的上下文放进 prompt cache 的固定前缀；语音回合不开思考、首句切到第一个逗号就送 TTS。合起来再省 0.5–1 s，目标落到 1.5 s 以内。TTS 首包要再降就得换一家支持流式输入文本的，换之前先按 docs/33 的测试台量首包。
3. 打断从「有声音就停」改成「说够几个字才停」。VPIO 留着；机器说话时用户语音先过 SpeechAnalyzer，转写够 3–4 个字且不在「嗯/对/好/是」词表里才算打断，附和只记不停；打断时把助手消息截到已播出的字，撤掉在飞的 LLM 和 TTS。这一条最直接改善「不自然」，2 s 免疫窗也可以随之缩短。

## 来源

- Smart Turn：https://github.com/pipecat-ai/smart-turn ；https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/ （2025-12-03）；https://huggingface.co/aufklarer/Smart-Turn-v3.2-CoreML ；https://docs.pipecat.ai/api-reference/server/utilities/turn-detection/smart-turn-overview.md （均查于 2026-10-14）
- Pipecat 打断与截断：https://docs.pipecat.ai/pipecat/fundamentals/interruptions.md ；iOS SDK：https://docs.pipecat.ai/api-reference/client/ios/overview.md
- 延迟预算和 Claude TTFT：https://voiceaiandvoiceagents.com/ （2026-06 更新）；https://www.pipecat.ai/benchmarks/voice-readiness （2026-08-18）
- STT 基准：https://hackernoon.com/pipecat-benchmarked-23-real-time-stt-models-for-voice-agents-there-isnt-one-winner （2026-09-24）
- LiveKit turn detector：https://livekit.com/blog/solving-end-of-turn-detection （2026-06-17）；https://docs.livekit.io/agents/build/turns/turn-detector ；许可：https://scancode-licensedb.aboutcode.org/livekit-model-2024.html
- LiveKit 自适应打断：https://livekit.com/blog/adaptive-interruption-handling （2026-03-19）；https://community.livekit.io/t/interruption-handling-model-region-plan-restrictions/1099
- LiveKit preemptive generation：https://docs.livekit.io/agents/build/audio ；https://futureagi.com/blog/how-to-optimize-livekit-latency-2026/
- TEN：https://github.com/TEN-framework/ten-turn-detection ；https://raw.githubusercontent.com/TEN-framework/ten-turn-detection/main/LICENSE ；https://github.com/TEN-framework/ten-vad ；https://github.com/TEN-framework/ten-framework
- Bolna：https://github.com/bolna-ai/bolna ；OpenAI VoicePipeline：https://openai.github.io/openai-agents-python/voice/pipeline/ ；FastRTC：https://huggingface.co/blog/fastrtc ；Ultravox：https://huggingface.co/fixie-ai/ultravox-v0_7-glm-4_6 、https://www.ultravox.ai/blog/introducing-the-ultravox-integration-for-pipecat （2026-01-16）
- Deepgram Flux 投机：https://developers.deepgram.com/docs/flux/voice-agent-eager-eot ；https://telnyx.com/release-notes/automatic-eager-end-of-turn-deepgram-flux
- Krisp VIVA：https://docs.pipecat.ai/pipecat/features/krisp-viva
- 填充语和双模型：https://arxiv.org/html/2511.07397v1 （ConvFill）；https://docs.inworld.ai/realtime/usage/responsiveness.md ；https://arxiv.org/html/2603.23346v1 （RelayS2S）；https://arxiv.org/pdf/2602.23266 ；https://excel.fit.vutbr.cz/submissions/2026/069/69.pdf （FIT-Voice）
- Prompt cache：https://arxiv.org/html/2601.06007v2 ；https://aws.amazon.com/blogs/machine-learning/effectively-use-prompt-caching-on-amazon-bedrock
- iOS AEC：https://developer.apple.com/forums/thread/829784 ；SpeechAnalyzer：https://dev.to/simple_memo/ios-26s-speechanalyzer-on-a-live-mic-the-5-things-the-docs-dont-tell-you-2ng5
- 中文 ASR：https://soniox.com/docs/stt/rt/endpoint-detection ；https://soniox.com/platform/chinese ；https://help.aliyun.com/en/model-studio/asr-model/
- TTS：https://arxiv.org/html/2601.15621 （Qwen3-TTS）；https://help.aliyun.com/en/isi/cosyvoice-api-details ；https://docs.cartesia.ai/concepts/continuations ；https://humannessindex.vapi.ai/models/cartesia-sonic-3 ；本仓库 docs/info/33-语音简报.md、docs/research/TTS供应商横评.md
- 业界区间：https://www.twig.so/blog/voice-ai-agents-latency-budget-800ms ；https://simbavoice.ai/resources/latency-engineering-for-real-time-voice-agents ；https://futureagi.com/blog/sub-500ms-voice-ai-guide-2026/
