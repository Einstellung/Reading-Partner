# 嘈杂/多人环境下的实时语音：方案调研

查证日期一律 2026-10-14。数字凡标"自报"的都是项目方自己测的，没有中立复现。

## 1. VAD

| 项目 | 效果数字 | 延迟/帧 | 体积 | iOS | 许可证 | 活跃度 |
|---|---|---|---|---|---|---|
| Silero VAD v6.2 | FLEURS-VAD-102 上 F1 95.95、误报 9.41%（FireRed 测）；v6 自报嘈杂真实数据错误 -16% | 32 ms 窗（512 样本/16k）；TEN 称其语音→静音判定滞后数百 ms | ONNX/JIT 约 2 MB | ONNX Runtime 可跑；sherpa-onnx 有 Swift 封装 | MIT | 10.4k star，2026-09-23 发 v6.2.3 |
| FireRedVAD（小红书） | 同集 F1 97.57、误报 2.69%、漏检 3.62%、AUC 99.60（自报） | 25 ms 帧 / 10 ms 移，流式 DFSMN | 0.57M 参数；社区 CoreML 版 2.2 MB（CPU+ANE，iOS 16+） | 有现成 CoreML 转换 | Apache-2.0 | 547 star，2026-05 最后推送 |
| TEN VAD（声网） | 同集 F1 95.19、误报 15.47%、漏检 2.95% | 10/16 ms 帧，自称静音判定比 Silero 快 | iOS framework 320 KB；iPhone 8 RTF 0.005 | 官方写明 iOS 包"不支持模拟器和 iPad"；有 ONNX 版可自行跑 | Apache-2.0 加附加条款：不得与 Agora 业务竞争、只能用于自己的应用 | 2.3k star，2026-10 仍在推 |
| WebRTC VAD | 同集 F1 52.30；Picovoice 测 5% 误报下召回 50% | 10/20/30 ms | 极小 | 可编进 | BSD | 停更（py 封装 2024-07） |
| Picovoice Cobra v2.1 | DEMAND 噪声下 5% 误报时召回 98.9%（Silero 87.7%）（自报） | 帧级 | 小 | 官方 iOS SDK | 商业，需 AccessKey 且要联网校验；有免费档 | 2026-10 仍在推 |

判断：能量 VAD 换成神经 VAD 是收益最大、成本最低的一步。首选 Silero v6（MIT、生态最全、明确为噪声训练过），拿 FireRedVAD CoreML 版在自录的咖啡馆/电视/旁人说话素材上做 A/B，它公开的误报率低得多，但测试集是干净朗读语音。TEN VAD 因许可证附加条款和 iPad 不支持排除。注意：任何 VAD 都只分"人声/非人声"，电视里的人声和旁人说话它照样判为语音，多人问题要靠第 3 节。

## 2. 降噪 / 语音增强

| 项目 | 效果数字 | 延迟 | 体积/算力 | iOS | 许可证 | 活跃度 |
|---|---|---|---|---|---|---|
| iOS Voice Isolation 麦克风模式 | Apple 官方的人声隔离 | 系统内 | 0 | app 不能设置：`preferredMicrophoneMode` 只读（"用户在控制中心选的模式"），只能用 `showSystemUserInterface(.microphoneModes)` 弹系统面板让用户选；选择按 app 记住；录音类 app 需 iOS 26 | 系统 | — |
| VPIO 自带处理 | AEC + AGC + 内置降噪；API 只暴露 AGC 开关、bypass、静音和"静音时检测到说话"事件，降噪强度不可调 | 系统内 | 0 | 已在用 | 系统 | — |
| GTCRN | VCTK-DEMAND PESQ 2.87（RNNoise 2.29、DeepFilterNet1 2.81）；DNS3 DNSMOS-OVRL 2.70（RNNoise 2.53） | 流式，i5-12400 RTF 0.07 | 48.2K 参数、33 MMAC/s；16 kHz | ONNX，sherpa-onnx 已集成 | MIT | 753 star，2026-08 仍在推 |
| DeepFilterNet 3 | VoiceBank-DEMAND PESQ 3.17 | 算法延迟 30 ms（48 kHz） | 2.17M 参数；Mac 上每 480 样本 hop 0.26 ms | 社区 CoreML 流式版（ANE + vDSP），无 iPhone/iPad 实测 | MIT / Apache-2.0 | 4.8k star，上游 2024-10 后停更 |
| RNNoise 0.2 | 见上，最弱 | 10 ms 帧 | 极小 | C 库可编进 | BSD-3 | 2024-04 发 0.2，2025-02 后无推送 |
| Krisp BVC / VIVA | 去掉旁人声音、无需注册（自报）；VIVA 放在 VAD 前 turn-taking 准确率 3.5 倍（自报） | <20 ms（自报） | — | 列出的绑定无 Swift；VIVA 是服务端 | 商业 | 活跃 |
| Picovoice Koala | — | — | — | 官方 iOS SDK | 商业，同 Cobra | 活跃 |

判断：不要把降噪后的音频喂给 SpeechAnalyzer。2025-26 年几篇研究（医疗 ASR 40 个配置全部变差、Whisper 在 SAM-Audio 增强后 WER 上升）都显示通用增强会伤现代 ASR，除非是按识别目标训练的。降噪只放在判定支路：原始 VPIO 音频给 ASR，GTCRN 处理过的副本给 VAD 和打断判定。第一步更便宜的是引导用户开 Voice Isolation：首次进语音时读 `preferredMicrophoneMode`，不是 voiceIsolation 就弹系统面板，OpenAI 的帮助文档也是这样建议 ChatGPT 用户的。我们走 VPIO，控制中心里大概率会出现 Mic Mode，要在 iPad 真机上确认一次。

## 3. 目标说话人（只听注册用户）

| 项目 | 效果数字 | 延迟 | 体积 | iOS | 许可证 | 活跃度 |
|---|---|---|---|---|---|---|
| 说话人验证 CAM++（3D-Speaker，zh+en 版） | 中英混合训练的 advanced 版；按段比对 embedding 余弦 | 段级，说完一句后算一次 | ONNX 28.3 MB（约 7M 参数） | sherpa-onnx Swift 示例有 speaker ID/verification | Apache-2.0 | sherpa-onnx 15k star，当天仍在推 |
| WeSpeaker ResNet34（cnceleb 版） | 中文 | 段级 | 26.5 MB | 同上 | Apache-2.0 | 同上 |
| Personal VAD 1.0/2.0 复现（wq2012，原论文作者之一） | 带噪声混响时 mAP 0.928（SET）/0.912（ET） | 帧级流式 | ET 13 万参数、量化 TFLite 265 KB；2.0 INT8 1.0 MB | TFLite，可上 iOS 但需自己接 | Apache-2.0 | 2026-10-11 仍在推；只在 8 种欧洲语言 MLS 上训练，无中文 |
| Personal-vad-2.0（fclearner） | 用 CAM++ embedding + Conformer + FiLM | 帧级流式 | — | PyTorch，需自训 | Apache-2.0 | 18 star，2026-08 |
| Picovoice Eagle | — | 帧级 | — | 官方 iOS SDK | 商业 | 活跃 |
| 目标说话人提取（TSE / VoiceFilter 类） | TargetVoice（Interspeech 2025，3 s 注册）、SpeakerBeam-SS、StarTSE 等 | 多为论文，StarTSE 在 4090 上 RTF 0.25 | — | 没有能直接上手机的开源实现 | — | 只有论文级代码 |

判断：现在能落地的是"VAD 切段 + 段级声纹验证"。注册可以不做专门流程：用户最初几轮在安静处说的话自动攒 10-20 秒算 embedding，存本地，之后每段（和每次打断）比对一次，不像本人就丢弃不送 ASR、不触发打断。阈值要在中英两种语言上各标一次。帧级 personal VAD 效果更好但没有中文模型，要自己训，排到后面。实时语音分离（TSE）在手机上还不成熟，不考虑。

## 4. 回声与误打断

| 手段 | 来源与数字 | 可用性 |
|---|---|---|
| TTS 走同一个 VPIO 引擎输出 | AEC 需要播放信号作参考，录放分两个 audio unit 会留回声（Apple 开发者论坛、Vivox 文档） | 先核对我们的播放路径 |
| 打断最短时长 + 误打断恢复 | LiveKit 默认 `min_duration` 0.5 s、`false_interruption_timeout` 2 s，期间没识别出字就从断点继续播 | 规则，自己实现 |
| 打断最少字数 | Pipecat `MinWordsInterruptionStrategy`（例子 min_words=3），只在 bot 说话时生效，短附和不算打断 | 规则，自己实现；中文按字数 |
| 声学打断分类模型 | LiveKit adaptive interruption：拒掉 51% 的 VAD 误报、真打断快 64%（自报） | 只在 LiveKit Cloud 推理，权重不开放 |
| 语义判句尾 | Smart Turn v3.2（Whisper Tiny 底，8M 参数，int8 8 MB，含中文 23 语种，CPU 最快 10 ms） | BSD-2，ONNX，可上 iOS |
| 神经残留回声抑制 | EchoFree（278K 参数）、Bark-scale RES 等 | 只有论文，没找到可用代码 |
| WebRTC AEC3 | 回声延迟超过约 0.5 s 时无声失效（LiveKit 社区报告） | VPIO 已覆盖，不必再叠 |

判断：外放时 TTS 播放期间切到"严格打断"模式——VAD 阈值调高、至少 0.5 s 连续人声、声纹验证通过，三者都满足才暂停（不是停止）播放；2 s 内 ASR 没出字就续播。这几条全是规则，不需要新模型。Smart Turn v3 可以替掉纯静音时长判句尾，减少嘈杂时"没说完就被抢话"。

## 5. 成熟产品的公开做法

| 产品 | 公开的手段 | 来源 |
|---|---|---|
| ChatGPT Voice | 帮助中心建议戴耳机、在 iPhone 上开 Voice Isolation 减少误打断；2026-07-08 换成 GPT-Live-1 全双工模型，称更能扛背景噪声、不在停顿处抢话 | help.openai.com/articles/8400625；Gigazine、IT Brief 2026-07 报道 |
| OpenAI Realtime API | `input_audio_noise_reduction` 分 near_field（耳机）和 far_field（笔记本/会议麦）；semantic_vad 的 eagerness 低/中/高 | OpenAI SDK 类型、Pipecat 文档 |
| Gemini Live | 2025-12-12 把暂停键换成静音键：静音时仍听得到 Gemini，背景噪声不再打断；同时修了长对话里乱打断（2.5 Flash Native Audio），iOS 2026 年初跟进 | jetstream.blog、TechRadar |
| LiveKit / Pipecat（开发框架） | 最短打断时长、最少字数、误打断后续播、声学打断分类 | 见第 4 节 |
| Krisp | 耳机场景下去旁人声音，无需注册 | 第 2 节 |
| 豆包实时通话 | 只公开"低延时、流畅打断"，没查到降噪/声纹/只听我说的公开说明 | ifanr 2025-01-20 |
| Alexa / Siri | 没有关于多人/嘈杂对话的产品文档；研究线是"是否在对设备说话"判定（2026 SAS 论文：电视对白使误触发从 2.1% 升到 7.8%，提阈值降到 3.4%） | arXiv 2604.08412 |

判断：几家的共同兜底是交互层：耳机优先、静音键、不行就换地方。对我们来说：①检测输出路由（`AVAudioSession.currentRoute` 是耳机/AirPods 时放宽打断，外放时用第 4 节严格模式）；②语音界面加静音键（VPIO 的 `isVoiceProcessingInputMuted` + 静音时说话事件可以提示"你在静音"）；③嘈杂时按住卢明说话作为兜底，松手即结束一轮，不依赖 VAD 判结束。

## 6. 端到端语音模型的噪声/多人鲁棒性

| 评测 | 结果 |
|---|---|
| FD-Bench（Interspeech 2025） | MUSAN 噪声 0/10/20 dB：Moshi 成功回复率约 60%，但噪声触发的误打断 38-48%；Freeze-Omni 误打断只有 4-7%（VAD 阈值 0.8），代价是成功回复率只有 10-15%；VITA-1.5 居中 |
| Full-Duplex-Bench v1.5 | "用户对别人说话"场景 GPT-4o Realtime 91% 接话、0.18 s 就让出；"背景人声"场景 GPT-4o 93% 接话、Gemini 70%；只有 Nova Sonic 基本无视背景人声（98% 续说） |
| MSI-Bench（2026-09-21） | 多人场景 1152 例中英各半：最强系统全通过率英文 66.8%、中文 54.5%；最强开源权重 34.0% / 19.3%；开源模型主要卡在多说话人前端，普遍会在没人对它说话时开口 |
| AHELM | 环境噪声鲁棒性 Gemini 2.5 Pro 最好、GPT-4o Audio 最差；Qwen2.5-Omni 噪声集 WER 0.103 |
| HumDial（ICASSP 2026 挑战赛）Track II | 专门测全双工下拒绝第三方语音、附和、停顿，用真人对话数据 |

判断：端到端模型在噪声和旁人说话上并不比级联稳，换模型解决不了这个问题，前端（VAD、声纹、打断规则）在两种架构下都要做。

## 在 iPad 上最该先上的组合

按顺序：

1. 能量 VAD 换 Silero v6（CoreML/ONNX），和 FireRedVAD 在自录嘈杂素材上 A/B 一次定选型。
2. 首次进语音检查 mic mode，引导用户开 Voice Isolation；同时核对 TTS 是否走同一个 VPIO 引擎。
3. 外放时的严格打断规则：播放期提高阈值、≥0.5 s、暂停而非停止、2 s 无字续播；戴耳机时放宽。
4. 静音键 + 按住卢明说话兜底。
5. CAM++ 中英版段级声纹门控，被动注册，同时卡住 ASR 送入和打断。
6. 之后再看：GTCRN 只进判定支路、Smart Turn v3 判句尾、自训中文 personal VAD。

前五步除声纹模型 28 MB 外都不增加体积，都是开源宽松许可证或系统 API。

## 来源（均于 2026-10-14 访问）

- Silero VAD releases：https://github.com/snakers4/silero-vad/releases
- FireRedVAD 对比表：https://huggingface.co/FireRedTeam/FireRedASR2-LLM/blob/main/README.md ；论文 https://arxiv.org/abs/2603.10420 ；CoreML 版 https://huggingface.co/illitan/FireRedVAD-CoreML
- TEN VAD：https://github.com/TEN-framework/ten-vad ，LICENSE 附加条款同仓库
- Picovoice Cobra：https://picovoice.ai/blog/best-voice-activity-detection-vad/ ；定价 https://picovoice.ai/pricing
- Apple 麦克风模式：https://support.apple.com/en-gb/HT213683 ；`preferredMicrophoneMode` 文档 https://developer.apple.com/documentation/avfoundation/avcapturedevice/preferredmicrophonemode ；开发者论坛 2026-09 未解答的提问 https://developer.apple.com/forums/thread/844448 ；AVAudioInputNode 文档 https://developer.apple.com/documentation/avfaudio/avaudioinputnode
- GTCRN：https://github.com/Xiaobin-Rong/gtcrn
- DeepFilterNet3 CoreML：https://huggingface.co/iky1e/DeepFilterNet3-Streaming-CoreML
- RNNoise 0.2：https://www.phoronix.com/news/RNNoise-0.2-Released
- 增强伤 ASR：https://arxiv.org/abs/2512.17562 ；https://arxiv.org/abs/2603.04710
- Krisp：https://www.businesswire.com/news/home/20250716580385/en ；https://krisp-ai-readme.static.hf.space/README.md
- Personal VAD 复现：https://github.com/wq2012/personal_vad ；https://github.com/fclearner/Personal-vad-2.0
- sherpa-onnx 声纹模型：https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models
- TSE 论文：https://www.isca-archive.org/interspeech_2025/pallala25_interspeech.html ；https://arxiv.org/abs/2604.19635
- VPIO 参考信号：https://developer.apple.com/forums/thread/665706 ；https://docs.unity.com/en-us/vivox-core/developer-guide/ios/acoustic-echo-cancellation
- LiveKit 打断参数：https://docs.livekit.io/reference/agents/turn-handling-options ；adaptive interruption https://livekit.com/blog/adaptive-interruption-handling ；AEC3 长延迟失效 https://community.livekit.io/t/ios-aec-persistent-issue-stuck-between-a-rock-and-a-hard-place/1785
- Pipecat：https://docs.pipecat.ai/server/utilities/interruption-strategies ；Smart Turn https://github.com/pipecat-ai/smart-turn
- 神经 RES：https://arxiv.org/abs/2508.06271 ；https://arxiv.org/abs/2404.11621
- OpenAI：https://help.openai.com/articles/8400625 ；GPT-Live https://www.gigazine.net/gsc_news/en/20260709-openai-gpt-live ；Realtime 降噪参数 https://pydantic.dev/docs/ai/api/realtime/openai/
- Gemini Live 静音键：https://jetstream.blog/en/gemini-live-adds-mute-button/ ；https://techradar.com/ai-platforms-assistants/gemini/google-just-fixed-one-of-the-most-annoying-things-about-talking-to-ai-gemini-live-can-finally-handle-interruptions
- 豆包：https://www.ifanr.com/1612635
- 设备指向判定：https://arxiv.org/abs/2604.08412
- FD-Bench：https://arxiv.org/abs/2507.19040 ；Full-Duplex-Bench v1.5：https://arxiv.org/abs/2507.23159 ；MSI-Bench：https://arxiv.org/abs/2609.24812 ；AHELM：https://arxiv.org/abs/2508.21376 ；HumDial：https://arxiv.org/abs/2601.05564
