# 播报 TTS 调研

查证日期一律 2026-08-09。每条标证据强度：官方文档 / 官方代码 / 第三方评测 / 社区代码 / 社区共识 / 未查证。本 session WebSearch 额度耗尽，全部结论来自直接抓取的官方页面、官方仓库源码、GitHub 代码检索和本仓库代码。

## 结论

主选硅基流动 CosyVoice2-0.5B，备选 MiniMax，离线兜底 webview 里的 `window.speechSynthesis`。播放形态是全 webview、按句合成、多个 `<audio>` + Blob URL 接力，不用 MSE 也不用 AudioContext。理由见第 6 节。

第 5 节是后台约束补充后加的，它推翻了两条原本的判断：端上模型在后台场景出局（第 3 节已改），以及 iPhone webview 上拿不到真正的边下边播，所以"流式协议"在选型里的权重要下调，备选从火山换成 MiniMax。

---

## 0 先定两条项目侧的事实

**Tauri http 插件的响应体是真流式。** `node_modules/@tauri-apps/plugin-http/dist-js/index.js:148-161` 构造的 `ReadableStream` 用 `pull: (controller) => readChunk(controller)` 逐块拉 `fetch_read_body`，不是一次性 buffer。HTTP chunked 的 TTS 首包到了就能播，`cleanTauriFetch` 这条路不用改。（本仓库代码）

**WebSocket 走不通，除非改 CSP。** `src-tauri/tauri.conf.json` 的 `connect-src 'self' ipc: http://ipc.localhost` 拦掉所有 `wss://`。`src-tauri/capabilities/default.json` 里 `http:default` 已经放开 `https://*`，但那是 http 插件的 scope，不覆盖 webview 直连的 WebSocket。火山和阿里的双向流式都是 WebSocket，要上就得二选一：把具体 wss 主机加进 `connect-src`，或者在 Rust 侧开 WS 再用 IPC/Channel 把音频喂给前端。（本仓库代码）

这两条直接决定了 HTTP chunked 的方案接入成本远低于 WebSocket 的方案。

---

## 1 Apple 原生 AVSpeechSynthesizer

### API 事实（官方文档）

https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer

- `speak(_:)` 入队，`pauseSpeaking(at:)` / `stopSpeaking(at:)` 带 `AVSpeechBoundary`（immediate / word），`continueSpeaking()`。
- `write(_:toBufferCallback:)` 和 `write(_:toBufferCallback:toMarkerCallback:)` 可以只拿音频 buffer 和 marker 元数据，不直接出声。
- delegate 有 `speechSynthesizer(_:willSpeakRangeOfSpeechString:utterance:)`，给出正在念的字符区间。
- `usesApplicationAudioSession`（默认 true）、`mixToTelephonyUplink`、`outputChannels`。
- iOS 7.0+。文档注明系统不持有 synthesizer，要自己 retain 到念完。

音质分档：`AVSpeechSynthesisVoiceQuality` 三个 case（iOS 9.0+）——
`default` "A basic quality voice that's available on the device by default."、
`enhanced` "An enhanced quality voice that you must download to use."、
`premium` "A premium quality voice that you must download to use."
（https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoicequality，官方文档）

关键：enhanced / premium 要**用户自己去系统设置里下载**，App 没有 API 代下。所以第三方 app 能稳定拿到的只有 default 档。

### 中文音质

default 档的中文（Tingting 那条线）仍然是拼接感明显的老引擎，enhanced 档明显好。没有任何可复现的公开中文 MOS 横评。（社区共识，未查证）

### Siri 声音 / iOS 26 新声音

`AVSpeechSynthesisVoice` 的官方符号表里只有 `speechVoices()`、`init(identifier:)`、`init(language:)`、`quality`、`gender`、`voiceTraits`，没有任何 Siri voice 的入口，Apple 也没公开过给第三方用的 Siri 声音。（官方文档 + 社区共识）

iOS 26 是否新增了更好的中文系统声音：**未查证**（没查到官方发布说明）。

Personal Voice：`requestPersonalVoiceAuthorization(completionHandler:)`，iOS 17.0+ / macOS 14.0+（官方文档 JSON 里 `introducedAt` 明确）。它是用户自己录的声音，不是"更好的中文播音腔"，对播报场景没用。

### 免费无限量

本地合成、不联网、无配额、无计费。（官方文档隐含，没有任何计费页面）

### 流式

不是"边收文本边合成"。它是整段 utterance 入队。做法是把长文按句切成多个 `AVSpeechUtterance` 连续 `speak()`，队列自己接续，首句延迟等于首句本地合成时间。具体毫秒数**未查证**。

### WKWebView 里的 window.speechSynthesis

**能拿到同样的声音，而且可能更多。** WebKit 的 Cocoa 实现直接包 AVFoundation：

```
Source/WebCore/platform/cocoa/PlatformSpeechSynthesizerCocoa.mm
:73   @interface WebSpeechSynthesisWrapper : NSObject<AVSpeechSynthesizerDelegate>
:78   const RetainPtr<AVSpeechSynthesizer> m_synthesizer;
:159  AVSpeechSynthesisVoice *avVoice = nil;
:300  - (void)speechSynthesizer:...willSpeakRangeOfSpeechString:(NSRange)characterRange...
:338  void PlatformSpeechSynthesizer::initializeVoiceList()
:349-355  speechVoicesIncludingSuperCompact / speechVoicesIncludingSuperCompactWithCompletionHandler:
```

（官方代码，WebKit/WebKit main 分支）注意 `:349-355` 用的是 `speechVoicesIncludingSuperCompact`，比公开的 `speechVoices()` 多出 super-compact 那批，所以 webview 里枚举到的声音是原生的超集。

浏览器兼容（MDN browser-compat-data，官方数据）：`SpeechSynthesis` 的 speak/cancel/pause/resume/getVoices/speaking/paused/pending 在 Safari 7 起全支持，`safari_ios` 和 `webview_ios` 都是 mirror；`SpeechSynthesisUtterance` 的 `boundary` / `mark` / `end` 事件 Safari 7 起支持，**Chrome 的 boundary 是 partial_implementation（crbug 40715888）**。我们只跑 WKWebView 和 WebKitGTK，正好落在支持的那一侧——`boundary` 事件的 `charIndex` 可以直接当"念到第几个字"。

SSML：`AVSpeechUtterance` 有 `init(ssmlRepresentation:)`（官方文档确认存在，引入版本号未精确查证）。Web Speech 那一层没有 SSML。

### Linux 桌面

WebKitGTK 的 speechSynthesis 后端是 flite/espeak 一类，中文有没有可用声音**未查证**，需要实测。按现有认知，Linux 桌面没有本地中文 TTS 兜底，只能走云端。

---

## 2 云端流式 TTS

### 硅基流动（主选）

**接口**（官方文档 https://docs.siliconflow.cn/cn/api-reference/audio/create-speech）
`POST https://api.siliconflow.cn/v1/audio/speech`，OpenAI 兼容。
字段：`model`、`input`、`voice`、`response_format`（mp3 / wav / pcm / opus）、`sample_rate`、`stream`（**默认 true**）、`speed`、`gain`。

**模型**：`FunAudioLLM/CosyVoice2-0.5B`、`fnlp/MOSS-TTSD-v0.5`（后者官方描述 "bilingual spoken dialogue synthesis model that supports both Chinese and English"）。

**音色**：预置 8 个 —— alex / benjamin / charles / david（男），anna / bella / claire / diana（女）。支持上传自定义音色（`POST /v1/uploads/audio/voice`，需实名）和参考音频零样本克隆。（官方文档）

**计费**：语音模型按「输出价格（/千字符 UTF-8）」，`FunAudioLLM/CosyVoice2-0.5B` 和 `fnlp/MOSS-TTSD-v0.5` 都是 **¥0.05 / 千字符 UTF-8**（https://siliconflow.cn/pricing 服务端渲染的价格表，2026-08-09 查证）。文档另注明"按照输入文本长度对应的 UTF-8 字节数进行计费"。汉字 3 字节，所以 1000 个汉字 ≈ 3000 字节 ≈ **¥0.15**。一份 2000 字的简报约 ¥0.3。

**流式**：HTTP chunked，官方 Python 示例就是 `stream=True` 迭代 chunk。配合上面第 0 节，Tauri 插件能真流式消费。

**TTFB**：官方没给数字，**未查证**。

**中英混读**：CosyVoice2 本身是中英双语模型，没有专门的混读开关，也没有 SSML。

**免费额度**：新用户赠额未查证。同站的 `FunAudioLLM/SenseVoiceSmall`（我们现在用的 STT）价格表里标"免费"。

### 火山引擎（备选）

**接口**（官方代码，volcengine/ai-app-lab，Apache-2.0，`arkitect/core/component/tts/`）
`wss://openspeech.bytedance.com/api/v3/tts/bidirection`，`api_resource_id = "volc.service_type.10029"`，header 带 access_key / app_key / conn_id / log_id。

二进制分帧协议（`constants.py` / `model.py`）：
- 头：`PROTOCAL_VERSION=0b1`，`HEADER_SIZE=0b1`，`message_type << 4 | type_flag`；type 有 FULL_CLIENT=0b0001 / AUDIO_ONLY_SERVER=0b0100 / FULL_SERVER=0b0011 / ERROR=0b0110，flag `WITH_EVENT=0b0100`，序列化 `JSON=0b0001`，压缩 `NO_COMPRESSION=0b0000`。
- 帧体：`>I` 大端 event 号 + （可选 connection_id 长度+内容）+（可选 session_id 长度+内容）+ payload 长度 + payload。
- 事件号：`StartConnection=1` / `FinishConnection=2` / `ConnectionStarted=50` / `StartSession=100` / `FinishSession=102` / `SessionStarted=150` / `SessionFinished=152` / `TaskRequest=200` / **`TTSSentenceStart=350`** / **`TTSSentenceEnd=351`** / `TTSResponse=352`。namespace `"BidirectionalTTS"`。
- 参数：`audio_params{format:"mp3", sample_rate:24000}`，`speaker` 默认 `"zh_female_tianmeixiaoyuan_moon_bigtts"`。

另有单次 HTTP：`https://openspeech.bytedance.com/api/v1/tts`，body 分 app{appid,token,cluster} / user / audio{voice_type,encoding,speed_ratio} / request{reqid,text,**text_type: "plain" | "ssml"**,operation:"query"}，cluster 常见 `volcano_tts`（大模型）和 `volcano_icl`（克隆）。（社区代码：AstrBotDevs/AstrBot `astrbot/core/provider/sources/volcengine_tts.py`、code-100-precent/LingEcho-App `server/pkg/synthesizer/volcengine.go`）

**流式**：`TaskRequest` 可以连续送文本片段，服务端回 `TTSSentenceStart` / `TTSSentenceEnd` / `TTSResponse`。这是这轮调研里唯一在协议层就管"流式文本输入 + 句子边界"的接口。

**中文音质**：豆包 TTS 的中文是国内公认第一梯队（社区共识，无独立横评）。

**定价、免费额度、TTFB 官方数字**：`www.volcengine.com/docs/*` 和 `volcengine.com/pricing` 都是 JS 渲染，`docs.byteplus.com` 也没拿到，**全部未查证**。

### MiniMax

**接口**（社区代码：AstrBotDevs/AstrBot `astrbot/core/provider/sources/minimax_tts_api_source.py`）
`POST https://api.minimax.chat/v1/t2a_v2?GroupId={group_id}`，Bearer key。
body：`model` / `text` / `stream: true` / `language_boost`（默认 auto）/ `voice_setting{speed, vol, pitch, voice_id, emotion, **latex_read**, **english_normalization**}` / `audio_setting{sample_rate:32000, bitrate:128000, format}` / 可选 `timber_weights`（多音色混合）。
`stream: true` 时响应是 SSE，chunk 里音频是 hex 编码。

**模型**：AstrBot 默认 `speech-02-turbo`，另有 `speech-02-hd`（社区代码）。Artificial Analysis 现在列的是 **Speech 2.8 HD** 和 **Speech 2.8 Turbo**（第三方评测，2026-08-09）。

**中文音色**：id 形如 `Chinese (Mandarin)_Warm_Girl`、`Chinese (Mandarin)_BashfulGirl`，另有旧式 `female-shaonv`。

**质量**（Artificial Analysis Quality Elo，2026-08-09 查证，注意这个 arena 主要是英文）：Speech 2.8 HD **1172.3**（榜上第 7），Speech 2.8 Turbo **1146.1**。吞吐 Speech 2.8 Turbo 161.1 字符/秒、2.8 HD 159.6 字符/秒。

**中英混读**：`english_normalization` 是专门的开关（英文按单词读而不是逐字母），`latex_read` 读公式。这是横评里对中英混读处理最明确的一家。

**定价**：价格页 JS 渲染，**未查证**。

### 阿里云百炼 CosyVoice / Qwen-Audio-TTS

**接口**（官方文档 https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api）
`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`（新加坡 `ap-southeast-1`），握手 header `Authorization: Bearer <api_key>`。
流程：建连 → `run-task` → `task-started` → 一次或多次 `continue-task` 送文本（即流式输入）→ 二进制通道下行音频 → `finish-task` → `task-finished`。同一任务所有事件共用 `task_id`，官方建议"复用 WebSocket 连接处理多个任务"。

**质量**：Artificial Analysis 上 **Qwen-Audio-3.0-TTS-Plus 以 Quality Elo 1228.7 排第一**（第三方评测，2026-08-09；同样注意是英文 arena）。

**音色列表、定价、免费额度、首包延迟**：help.aliyun.com 内容区是 JS 渲染，抓不到，**全部未查证**。

### EdgeTTS

**接口**（官方代码：rany2/edge-tts `src/edge_tts/constants.py`、`drm.py`）
`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`
音色列表 `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=...`

要伪装成 Edge 的 Read Aloud：UA 伪装 Chromium 143、`Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`、Sec-CH-UA 伪装 Edge，并且每个请求都要算 `Sec-MS-GEC`（SHA256 over Windows-epoch 时间戳 + TRUSTED_CLIENT_TOKEN，还带时钟偏移校正逻辑 `DRM.adj_clock_skew_seconds`）。

**风险**：不是官方 API。README 明写 "Support for custom SSML was removed because Microsoft prevents the use of any SSML that could not be generated by Microsoft Edge itself" —— 微软已经主动封过一轮，之后又加了 DRM 令牌。把播报这条核心链路押在逆向接口上，还要在 app 里内置伪造的客户端令牌和扩展 id，稳定性和合规都不成立。

**license**：edge-tts 本体 LGPLv3（仅 `srt_composer.py` 是 MIT）。

### OpenAI

**接口**（官方文档 https://developers.openai.com/api/docs/guides/text-to-speech 和 .../api-reference/audio/createSpeech）
`POST https://api.openai.com/v1/audio/speech`
字段：`model`（`tts-1` / `tts-1-hd` / `gpt-4o-mini-tts` / `gpt-4o-mini-tts-2025-12-15`）、`input`（上限 4096 字符）、`voice`（alloy / ash / ballad / coral / echo / fable / onyx / nova / sage / shimmer / verse / marin / cedar，或自定义 voice 对象）、`instructions`（自然语言控语气，tts-1 系不支持）、`response_format`（mp3 / opus / aac / flac / wav / pcm）、`speed`（0.25–4.0）、`stream_format`（`sse` 或 `audio`，`sse` 不支持 tts-1 系）。

**流式**：chunked transfer，"the audio can be played before the full file is generated"；官方建议低延迟用 `wav` 或 `pcm`。

**定价**（https://developers.openai.com/api/docs/pricing，2026-08-09 查证）：
`tts-1` **$15.00 / 1M characters**；`tts-1-hd` **$30.00 / 1M characters**；`gpt-4o-mini-tts` 文本输入 **$0.60 / 1M tokens** + 音频输出 **$12.00 / 1M tokens**。

**中文**：官方称语言支持"generally follows the Whisper model"，99 种语言含普通话。中文播音腔带外国口音倾向，明显不如国内几家（社区共识）。

### ElevenLabs

**接口**（官方文档）`POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`，流式变体加 `/stream`，带字符级时间戳的是 `POST /v1/text-to-speech/{voice_id}/with-timestamps`。
关键字段：`apply_text_normalization`（`auto` / `on` / `off`，默认 auto）、`language_code`（ISO 639-1，multilingual_v2 不支持）、`previous_text` / `next_text`（跨块韵律连续）。

**with-timestamps 返回**：`alignment` 和 `normalized_alignment`，各含 `characters`、`character_start_times_seconds`、`character_end_times_seconds`。

**延迟**：Eleven Flash v2.5 官方标 "Ultra-low latency (~75ms†)"（不含应用和网络延迟），32 语言含中文；Eleven v3 70+ 语言含普通话（cmn）。

**质量**：Artificial Analysis Elo，Eleven v3 **1171.3**、Multilingual v2 **1097.8**（第三方评测，2026-08-09）。

**定价**（https://elevenlabs.io/pricing/api，2026-08-09 查证）：Flash / Turbo **$0.05 / 1K characters**，Multilingual v2 / v3 **$0.10 / 1K characters**。换算 **$50 和 $100 / 1M characters**，是 OpenAI tts-1 的 3.3 倍和 6.7 倍。中文按字符计费尤其亏——同样信息量的汉字数少但单价一样，实际上不亏，但绝对值仍然是横评里最贵的。

**中文音质**：多语言模型的中文可用但不是强项（社区共识，无中文横评）。

### 横向一句话

| 供应商 | 协议 | 流式 | 单价（2026-08-09） | 中英混读抓手 | 接入成本 |
|---|---|---|---|---|---|
| 硅基流动 CosyVoice2 | HTTP chunked，OpenAI 兼容 | 是，默认开 | ¥0.05/千 UTF-8 字节 | 无（模型本身双语） | 最低，key 已有 |
| 火山 bidirection | WebSocket 二进制分帧 | 是，协议级 | 未查证 | v1 HTTP 支持 SSML | 高，要改 CSP + 自己实现分帧 |
| MiniMax T2A v2 | HTTP + SSE | 是 | 未查证 | `english_normalization` / `latex_read` | 中 |
| 阿里 CosyVoice / Qwen-Audio-TTS | WebSocket 事件 | 是，流式输入 | 未查证 | 未查证 | 高，要改 CSP |
| EdgeTTS | WebSocket，逆向 | 是 | 免费 | SSML 被封 | 中，但不该用 |
| OpenAI | HTTP chunked / SSE | 是 | $15–30/1M chars | `instructions` | 低 |
| ElevenLabs | HTTP chunked | 是 | $50–100/1M chars | `apply_text_normalization` | 低 |

---

## 3 本地 / 端上（结论：**仅前台可用**，后台出局）

前置：iOS 后台 CPU 预算约 15 秒窗口内 9 秒，超限直接终止进程（来自并行的后台音频调研）。下面所有端上模型都是持续占 CPU 合成，锁屏后台念简报必然超预算。所以这一节的东西**只在前台场景成立**——用户坐着看简报顺便让它念，或者桌面 Linux（不受此限）。后台播报只能用云端 TTS（网络等待不吃 CPU）或 Apple 原生（系统进程合成，不算 app 的预算）。

RTF 数字要按这个标准重读：RTF 0.391 意味着念 1 分钟要占 23 秒 CPU，均摊到每个 15 秒窗口是 5.9 秒，已经逼近 9 秒上限；Kokoro 的 RTF 3.191 直接是 3 倍超支。（RPi4 的 RTF 不能直接搬到 A 系列芯片，但比例关系说明问题；iPhone 上的实测 RTF 未查证。）


### sherpa-onnx

仓库 Apache-2.0，自带 `build-ios.sh` / `build-ios-no-tts.sh` 和 `wasm/tts` 目录，iOS 和 WASM 都是官方支持路径（官方仓库）。所有中文模型都带 FST 规则文本正则化组件。

中文模型（官方文档 https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/）：

| 模型 | 体积 | 说话人 | RTF（RPi4） | 授权 |
|---|---|---|---|---|
| matcha-icefall-zh-baker | 声学 72MB + vocos 声码器 51MB | 1 女 | 4 线程 **0.391**，1 线程 0.892 | 数据集明确 "for non-commercial use only" |
| vits-zh-aishell3 | 29MB | 174 | 未查证 | aishell3 |
| vits-zh-ll | 115MB，16kHz | 5 | 未查证 | 来源不清 |
| vits-zh-hf-fanchen-C / wnj | 115–116MB，16kHz | 187 / 1 | 未查证 | HF 社区模型，授权不清 |
| vits-zh-hf-theresa / eula | 116MB，22.05kHz | 804 | 未查证 | 转自 genshin-bh3 游戏语音，授权有问题 |
| kokoro-multi-lang-v1_0 | 约 310MB | 53，中英 | 4 线程 **3.191**（比实时慢 3 倍） | Apache-2.0 |
| kokoro-multi-lang-v1_1 | 约 310MB | 103，中英 | 未查证 | Apache-2.0 |

注意 aishell3 那个只有 8kHz 采样率，念简报会明显发闷。

**真正的 license 问题不在 sherpa-onnx 本体（Apache-2.0），在每个模型的训练数据集。** matcha-icefall-zh-baker 是唯一 RTF 好看的，恰好是 non-commercial only。本项目现在是 PolyForm-NC，NC 数据集暂时不冲突；一旦想商用全部作废。

### Kokoro

`hexgrad/Kokoro-82M` 和 `hexgrad/Kokoro-82M-v1.1-zh` 在 HF 上都标 `license:apache-2.0`（HF API 元数据，2026-08-09）。zh 版含 `zf_001`–`zf_0xx` / `zm_0xx` 系列中文音色。82M 参数，sherpa 打包的 onnx 约 310MB。授权最干净，但 WASM 里塞 310MB 模型不现实，iOS 上 RTF 也不理想。

### GPT-SoVITS

MIT（GitHub API，2026-08-09）。是少样本克隆/训练框架，推理端不为端上实时设计，没有官方 iOS 或 WASM 路径。不适合这个场景。

### Fish-Speech

**FISH AUDIO RESEARCH LICENSE AGREEMENT，Last Updated 2026-03-07**（仓库 LICENSE，官方代码）：明写 "This Agreement is intended to allow research and non-commercial uses of the Materials free of charge. Any Commercial use of the Materials requires a separate license from Fish Audio."。GitHub API 的 license 字段是 NOASSERTION。source-available 的商业软件要单独谈授权。Artificial Analysis 上 Fish Audio S2 Pro Elo 1120.5。

### 端上小结

体积小、中文能听、授权干净——三者现在凑不齐。加上后台 CPU 预算这条，端上模型在 iPhone/iPad 上只剩"前台离线播报"这一个用途，为它打包 72–310MB 模型不划算。要离线兜底就用 Apple 原生（系统进程合成，不占 app 的后台 CPU 预算，零打包体积，授权无问题）。桌面 Linux 是唯一值得考虑端上模型的地方，但 Linux 也没有断网需求。

---

## 4 播报场景的四个具体问题

### 4.1 切句

业界做法是在 TTS 前面放句子聚合器：LLM 的 token 流按标点边界攒够一句就送 TTS，不等整段生成完。两家把这件事做进了协议——火山的 `TaskRequest` 可以连续送文本片段、服务端回 `TTSSentenceStart` / `TTSSentenceEnd`，阿里的 `continue-task` 同理（官方代码 / 官方文档）。

中文切句的具体规则（社区共识，没有标准）：
- 硬边界：`。！？；：` 和换行。
- 软边界：`，、` 且当前累积长度超过阈值（8–12 字量级），避免把 "OpenAI，" 切成一个碎句。
- 首句放宽：第一个软边界就发，把首字延迟压到最小；后续句子攒长一点，韵律更连贯。
- 不要在英文缩写、数字、URL 中间切。切之前先跑一遍下面 4.2 的规范化，规范化之后再切，边界才稳定。

ElevenLabs 的 `previous_text` / `next_text` 是给分块合成补韵律连续性的官方字段，值得抄这个思路：即使换供应商，也把上一句和下一句一起传（能传的话）。

### 4.2 数字、缩写、URL、日期读对

各家提供的抓手（都是官方文档 / 官方代码）：

- 火山 v1 HTTP：`text_type: "ssml"`。
- MiniMax：`english_normalization`（英文按单词读而非逐字母）、`latex_read`。
- ElevenLabs：`apply_text_normalization`（auto / on / off）、`language_code` 强制语言和正则化。
- OpenAI：没有 SSML，只有 `instructions` 自然语言指令。
- 硅基流动 `/v1/audio/speech`：没有 SSML 字段，也没有正则化开关。
- sherpa-onnx：FST 规则表，可以自己加词条。
- Apple：`AVSpeechUtterance(ssmlRepresentation:)`；Web Speech 那层没有。

"GPT-5" 具体被念成什么、"2026-08-09" 被念成什么，各家都没有公开说明，**未查证**，只能实测。

**靠谱做法是自己做一层文本规范化，不指望供应商。** 送 TTS 之前跑一个纯文本函数：
- 日期 `2026-08-09` → "二〇二六年八月九日"；`8/9` 这类靠上下文判断，不确定就原样。
- 版本号 `GPT-5` → "G P T 五"；`GPT-4o` → "G P T 四 o"。
- 全大写缩写查表：已知词按发音展开（arXiv → "阿卡evi" 之类要实测），未知的逐字母。
- URL 整条替换成"链接"或域名主体，不要念协议和路径。
- 纯数字按中文习惯：年份逐位读，数量按位数读。

这一层是无依赖的纯函数，按 CLAUDE.md 的分层就该放 `.ts` 并配单测，`.tsx` 不碰。换供应商它不动。

### 4.3 打断：停播 + 知道播到哪个字

两件事分开做。

**停播**：保留正在播的 `AudioBufferSourceNode`（或 MediaSource / HTMLAudioElement）的引用，`stop()` 并 disconnect；同时 abort 在飞的 TTS fetch 和 LLM 流。`cleanTauriFetch` 已经把插件的两种中止表现归一成标准 `AbortError`（`src/platform/app/tauri-fetch.ts`），这条路现成。

**知道播到哪**，三种成熟做法，按精度递减：

1. **字符级时间戳**（最准）。ElevenLabs `with-timestamps` 直接返回 `characters` + `character_start_times_seconds` + `character_end_times_seconds`，拿当前播放位置二分即可（官方文档）。这是横评里唯一提供字符级对齐的商业接口。
2. **句级事件**。火山的 `TTSSentenceStart=350` / `TTSSentenceEnd=351`，自己维护"已播完的句子列表 + 当前句"，截断到当前句开头（保守）或按句内播放时间比例线性估算（官方代码）。
3. **本地合成的 boundary 事件**。`AVSpeechSynthesizer` 的 `willSpeakRangeOfSpeechString` 给 NSRange，Web Speech 的 `boundary` 事件给 `charIndex`；Safari / WKWebView / WebKitGTK 都支持（官方文档 + MDN BCD）。

没有以上任何一种的供应商（硅基流动、OpenAI）只能自己算：按已经喂进 AudioContext 的 PCM 字节数 / (采样率 × 声道 × 位深) 得到已播秒数，再按"这一句共 N 字、总时长 T"线性插值到字符位置。中文语速均匀，误差在一两个字，对"把助手消息截断到用户真正听到的位置"够用。（社区共识，无官方方案）

docs/27 里"打断要把助手消息截断到用户真正听到的位置"这条，落地就是上面这三级降级：有字符时间戳用字符时间戳，有句事件用句事件，都没有就按字节数估算。

4.3 的第一级和第二级在 5.3 的形态下都用不上也不需要：每句一个 `<audio>`，"播到哪"直接读 `currentTime / duration` 加句内线性插值，精度比按 PCM 字节数估算更好，而且不依赖任何供应商特性。

### 4.4 一个额外的坑

`Cross-Origin-Embedder-Policy: require-corp` 已经在 tauri.conf.json 的 headers 里。经 Tauri http 插件拿到的是纯字节，走 `AudioContext.decodeAudioData` 或 `MediaSource`，不受 CORP 影响；但如果哪天想直接 `<audio src="https://...">` 就会被 COEP 拦。（本仓库配置，推断）

---

## 5 后台与形态约束（补充调研，2026-08-09）

来自并行的 iOS 后台音频调研：后台 CPU 预算 15s/9s；WKWebView 无视宿主 AVAudioSession，宿主改自己的 session 会打断 webview 的音频（WebKit bug 167788）；WebKit 的 AudioContext 在页面 hidden 时被挂起（bug 237878）；后台长静音会被判定停止播放并挂起 app。下面把这四条落到 TTS 选型上。

### 5.1 形态二选一，`speechSynthesis` 属于 webview 这一侧

因为宿主和 webview 的音频会话互斥，只能全 webview 或全原生。两条路对 Apple 原生 TTS 的意义不同：

- **全原生形态**：直接用 `AVSpeechSynthesizer`，原生 `AVAudioEngine` 播音，宿主完全控制 AVAudioSession（`.playback` + `UIBackgroundModes: audio`）。后台播报的正规做法。代价是所有 TTS 音频都得从 Rust/Swift 侧走，前端只剩控制和显示。
- **全 webview 形态**：用 `window.speechSynthesis`，音频由 WebKit 自己的媒体会话播。宿主不能碰 AVAudioSession。

**`window.speechSynthesis` 在 WKWebView（非 Safari）里能不能拿到系统中文声音、音质是否和原生一致——能，且一致。** 三条证据：

1. 特性开关默认打开。`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml:8516-8530`：
   ```yaml
   SpeechSynthesisAPIEnabled:
     status: embedder
     defaultValue:
       WebKitLegacy: {default: true}
       WebKit:       {default: true}      # WebKit = WKWebView
       WebCore:      {default: true}
     disableInLockdownMode: true
   ```
   `WebKit` 那一档就是 WKWebView，默认 true。`status: embedder` 表示宿主可以关掉，但不关就是开的。唯一的例外是 **Lockdown Mode 下会被禁用**——用户开了锁定模式，webview 里的 speechSynthesis 直接没有，全 webview 形态在这种设备上没有本地兜底。（官方代码）

2. 同一个引擎。`Source/WebCore/platform/cocoa/PlatformSpeechSynthesizerCocoa.mm:73/78/143` 里 `WebSpeechSynthesisWrapper` 持有 `AVSpeechSynthesizer` 实例，`:159-166` 用 `AVSpeechSynthesisVoice` 和 `AVSpeechUtterance` 构造。音质就是原生音质，没有二次转码。（官方代码）

3. 声音列表是原生的**超集**。`:349-355` 用 `speechVoicesIncludingSuperCompact`（含 super-compact 那批），公开 API `speechVoices()` 不返回这些。中文声音只要系统里有，webview 里就枚举得到；enhanced/premium 同样要用户先在系统设置里下载，App 侧无解。（官方代码）

结论：把 Apple 原生 TTS 当兜底，**不需要**为它选"全原生"形态。`window.speechSynthesis` 在 webview 里就是它，还顺带白拿 `boundary` 事件的 charIndex。这条消掉了形态二选一对 TTS 选型的约束。

### 5.2 iPhone webview 上流式音频怎么播——MSE 这条路走不通

查证结果，三条独立证据指向同一结论：

- **普通 MSE 在 iPhone 上没有。** MDN BCD `api/MediaSource.json`：`safari_ios` `{"version_added": "13", "partial_implementation": true, "notes": "Exposed in Mobile Safari on iPad but not on iPhone."}`，`webview_ios: "mirror"`。caniuse 同样标注 "Fully supported only in iPadOS, 13 and later"，一路到 26.5 都是 `a #2`。（官方数据，2026-08-09）
- **ManagedMediaSource 有，iOS 17.1 起，WKWebView 也有。** MDN BCD `api/ManagedMediaSource.json`：`safari_ios: {"version_added": "17.1"}`，`webview_ios: "mirror"`。WebKit blog 17.1：「Managed Media Source is also available on iPhone with iOS 17.1 beta.」WebKit 侧 `ManagedMediaSourceEnabled` 是 `status: mature`。（官方数据 + 官方博客 + 官方代码）
- **但 MMS 只吃 fragmented MP4。** WebKit 在 Cocoa 上的 MSE 解析器只有两个来源：`SourceBufferParserWebM` 和 `SourceBufferParserAVFObjC`（`Source/WebCore/platform/graphics/cocoa/SourceBufferParser.cpp:43-56`）。后者把类型判断整个交给 `AVStreamDataParserMIMETypeCache::canDecodeType`（`SourceBufferParserAVFObjC.mm:204-214`），而它的预解析器只对 `video/mp4` 和 `audio/mp4` 生效（`:216-220`）。`UnifiedWebPreferences.yaml` 里根本没有 WebM MSE 的开关。**`audio/mpeg`（裸 MP3）不是合法的 MSE 容器。**（官方代码，推断强度：高）

再加一条 MMS 自己的坑：MDN 明写「On Safari, `ManagedMediaSource` only activates when remote playback is explicitly disabled on the media element (by setting `HTMLMediaElement.disableRemotePlayback` to `true`)... Without either of these, the `sourceopen` event will not fire.」（官方文档）

把这几条合起来：所有 TTS 供应商吐的都是 mp3 / wav / pcm / opus / aac，**没有一家吐 fMP4**。要走 MMS 就得在 webview 里把 MP3 或 AAC 实时封装成 fragmented MP4（mux.js 那一路），为了几百毫秒的首包收益背一个 remuxer，并且只在 iOS 17.1+ 成立。不值得。

### 5.3 替代方案：按句合成，多个 `<audio>` 接力

放弃"一条音频流边下边播"，改成"每句一个完整的短音频，排队接力播"：

1. LLM 输出按 4.1 的规则切句。
2. 每句单独发一次 TTS 请求，用 `cleanTauriFetch` 拿到完整字节（几 KB 到几十 KB），`new Blob([bytes], {type:'audio/mpeg'})` + `URL.createObjectURL`。
3. 两个 `<audio>` 元素交替：A 在播的时候 B 已经 `preload` 好下一句，A 的 `ended` 里立刻 `B.play()`。
4. 提前 2–3 句预取，把网络延迟藏在播放时间里。

这样：
- **不需要 MSE / MMS**，`<audio>` + Blob URL 是 iOS 8 就有的东西，iPhone/iPad/Linux 一视同仁。
- **不碰 AudioContext**，绕开 bug 237878 那条路。媒体元素也是 iOS 的 now-playing / 后台音频机制唯一认得的东西。
- **首字延迟 = 第一句的完整合成时间**，不是首字节时间。一句 20 字的中文，云端 TTS 通常 300–800ms（未查证，需实测）。比真流式差几百毫秒，但比"整段合成完再播"好一个数量级。
- **白拿句级位置追踪**。当前播到第几个 `<audio>` 就是第几句，配合元素的 `currentTime / duration` 做句内插值，4.3 那三级降级里的第二级直接落地，不用依赖供应商的 SentenceStart 事件。
- **打断变简单**：`audio.pause()` + `revokeObjectURL` + 清队列 + abort 在飞的请求。

代价是每句一次 HTTP 往返。硅基流动按 UTF-8 字节计费，不按请求数，所以拆句不涨钱。

**这个结论反过来削弱了"流式 TTS"在选型里的权重。** 既然 iPhone webview 上拿不到真正的边下边播，各家的流式协议优势（火山的 bidirection、阿里的 continue-task）就只剩"服务端可以边收文本边合成"这一半，客户端那一半用不上。按句请求的非流式接口反而更简单。

如果将来走全原生形态，情况反过来：Swift 侧可以把 PCM 直接喂 `AVAudioEngine` 的 `AVAudioPlayerNode`，真流式的价值才兑现。这是决定形态时要一起考虑的事。

### 5.4 静默期保活，哪家接口更友好

按 5.3 的形态，播报之间的静默期垫无声音频很自然：预生成一小段无声 MP3，循环播在同一套 `<audio>` 接力队列里，媒体元素从不进入 ended 状态。这一层和 TTS 供应商无关，任何一家都一样。

真正有差别的是**长句/长段落的连续性**：ElevenLabs 的 `previous_text` / `next_text` 让分句请求之间的韵律接得上，是横评里唯一为"拆句合成"设计的字段。硅基流动、OpenAI、MiniMax 都没有对应字段，拆句处的语调断裂只能靠切句规则（在句号切而不是逗号切）缓解。

火山和阿里的 WebSocket 是"一条连接多个任务"（阿里官方文档明确建议复用连接），对连续播放友好，但那个优势在 5.2 的约束下拿不到。

---

## 6 推荐

形态先定：**全 webview**，音频用 `<audio>` + Blob URL 按句接力（5.3），不用 MSE、不用 AudioContext。Apple 兜底走 `window.speechSynthesis`（5.1 证明它和原生同引擎同音色），所以选 webview 形态不损失任何 TTS 能力。

### 主选：硅基流动 `FunAudioLLM/CosyVoice2-0.5B`

- key 已有，base_url 和现在的 STT 同一个（`src/ai/voice/index.ts` 那条 OpenAI 兼容客户端几乎能原样复用，只换 `/v1/audio/transcriptions` → `/v1/audio/speech`）。
- 按句请求、`response_format: "mp3"`、`stream: false`，直接拿完整字节做 Blob。**不用动 CSP、不用写 Rust、不用 remuxer。** 它的 HTTP chunked 流式能力现在用不上，但接口本身两种都支持，将来转全原生形态可以无缝改成真流式。
- ¥0.05 / 千 UTF-8 字节 ≈ ¥0.15 / 千汉字，一份 2000 字简报约 ¥0.3。按字节计费不按请求数，拆句不涨钱。是横评里唯一价格明确且便宜的。
- CosyVoice2 本身是中英双语模型，"OpenAI 发布了 GPT-5" 这种句子不用切模型。
- 后台可用：网络等待不吃 CPU 预算，解码交给系统媒体栈。
- 缺字符级时间戳、SSML 和跨句韵律字段。字符时间戳用 5.3 的 `<audio>.currentTime` 补（比原计划的字节估算更准也更简单），SSML 用 4.2 的自建文本规范化补，跨句韵律只能靠切句规则缓解。

### 备选：MiniMax `speech-02-turbo` / Speech 2.8 Turbo

**换掉了原来的火山。** 火山的全部优势（bidirection 协议级流式 + SentenceStart/End 事件）在 5.2 的约束下兑现不了，却要付出改 CSP、自己实现二进制分帧、价格未知三份成本。同样是按句请求，MiniMax 更合适：

- 普通 HTTPS POST，不碰 WebSocket，CSP 不用动。
- `english_normalization` 和 `latex_read` 是横评里对中英混读最明确的开关，正好打在"OpenAI 发布了 GPT-5"这个痛点上。
- Artificial Analysis Quality Elo 上 Speech 2.8 HD 1172.3 / Turbo 1146.1，第一梯队（英文 arena，中文未验证）。
- 未查证的是价格。上之前必须先确认。

火山降为第三选择，只在"确定要转全原生形态"之后才重新考虑——那时真流式和 SentenceStart/End 才值钱。

### 离线兜底：`window.speechSynthesis`

零成本、零打包体积、授权无问题、不占后台 CPU 预算，`boundary` 事件还免费给字符位置。音质是 default 档的老引擎，只当断网降级。两个已知空洞：Lockdown Mode 下 `SpeechSynthesisAPIEnabled` 被禁（5.1），以及 WebKitGTK 上有没有可用中文声音未查证——Linux 桌面很可能没有兜底。

### 明确不选

- **EdgeTTS**：逆向接口，要在 app 里内置伪造的 TrustedClientToken、Sec-MS-GEC 算法和 Edge 扩展 id，微软已经封过一轮 SSML。核心链路不能押在这上面。
- **ElevenLabs**：$50–100 / 1M characters，比 OpenAI tts-1 贵 3–7 倍，中文还不是强项。它的 `with-timestamps` 和 `previous_text/next_text` 值得抄设计，不值得买。
- **OpenAI TTS**：$15/1M chars，中文腔调带外国口音。
- **端上模型**：后台 CPU 预算直接判死（第 3 节），前台场景又要为它打包 72–310MB 且授权有坑。
- **MSE / ManagedMediaSource 边下边播**：iPhone 上要 iOS 17.1+ 且只吃 fMP4，没有 TTS 供应商吐 fMP4，得自己背 remuxer（5.2）。

---

## 未查证清单

- 火山引擎 TTS 的定价、免费额度、官方 TTFB 数字（docs.volcengine.com 全站 JS 渲染，BytePlus 英文站也没拿到）。
- 阿里云百炼 CosyVoice / Qwen-Audio-TTS 的定价、免费额度、音色列表、首包延迟（help.aliyun.com 内容区 JS 渲染）。
- MiniMax 的定价（platform.minimaxi.com 价格页 JS 渲染）。
- 硅基流动 TTS 的 TTFB 和新用户免费额度。
- 任何一家的**中文** TTS 音质横评。Artificial Analysis 的 Quality Elo 是主要面向英文的 arena（Qwen-Audio-3.0-TTS-Plus 1228.7 第一、MiniMax Speech 2.8 HD 1172.3 第七、Eleven v3 1171.3），不能直接当中文结论用。
- iOS 26 是否新增了更好的中文系统声音。
- AVSpeechSynthesizer 在 iPhone 上合成一句中文的实际耗时。
- WebKitGTK 在 Linux 上的 speechSynthesis 有没有可用的中文声音。
- 各家对 "GPT-5"、"arXiv"、"2026-08-09" 的实际读法。
- `AVSpeechUtterance(ssmlRepresentation:)` 的引入版本号。
- 各家按句请求（20 字左右）的实际端到端耗时。这是 5.3 那个形态成不成立的唯一未知数，必须实测。
- WebKit bug 237878「AudioContext is suspended on iOS when page is backgrounded」在 bugzilla 上是 **RESOLVED FIXED（r291390，2022-03-17）**，但评论区到 iOS 16.3 仍有人报同样现象。当前 iOS 26 上 AudioContext 后台到底挂不挂，未查证。不影响结论——5.3 的方案本来就不用 AudioContext，媒体元素才是 iOS 后台音频机制认得的东西。
- WKWebView 里 `<audio>` 播放要在后台继续，宿主 app 需要哪些配置（`UIBackgroundModes: audio` 之外还有没有 WKWebView 侧的开关），以及它和"WKWebView 无视宿主 AVAudioSession"怎么相互作用。这块归后台音频调研。
- 两个 `<audio>` 交替接力在 iOS 上的实际间隙有多大（毫秒级还是能听出来）。
