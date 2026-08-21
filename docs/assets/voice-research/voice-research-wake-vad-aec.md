# 唤醒词 / VAD / 轮次检测 / 回声消除 调研

> 只读调研，2026-08-09。场景：iPhone/iPad，Tauri v2 + WKWebView，AI 念简报时用户手湿不能点屏幕，设备可能外放也可能戴 AirPods。项目 source-available 商用（PolyForm-NC），GPL/AGPL 不可用。
> 每条外部事实带 URL 和查证日期，证据强度标在括号里：官方文档 / 源码 / 官方 README / 单个帖子 / 未查证。

---

## 结论先行

作废 2026-08-21："webview 形态成立，不必退到全原生"已被推翻，形态定为全原生（docs/33「形态：全原生」）。AEC/后台测量数据仍然成立，是那个决定的依据之一。

外放场景下全双工能成立，但**不能靠 `getUserMedia` 默认路径**。iOS WKWebView 确实给真 AEC（WebKit 源码证实），可是 AEC 的参考信号只接了 MediaStreamTrack 播放这一条路；`<audio src>` 和 Web Audio 直接输出不在参考路径里。要么把 TTS 播放绕成 MediaStream，要么退回半双工。

**后台/锁屏也能活**（第二轮核实，见 §7）：WebKit 对"播 MediaStream 音频 + 同时在采集"这个组合有明写的后台和锁屏豁免；AudioContext 只要不连 `ctx.destination` 就不会被后台中断。webview 形态成立，不必退到全原生。

唤醒词选 sherpa-onnx KWS：Apache-2.0，中英双语模型 13MB，关键词纯文本自定义，iOS 有官方 xcframework，WASM 有 kws 构建目标。Porcupine 中文更成熟但价格不公开、必须联系销售，且明确说"没有面向个人/非商业的免费或付费档"。

---

## 1. 唤醒词（KWS）

作废 2026-08-21：唤醒词降为备案，不在当前语音工作范围内（docs/33「VAD 和轮次检测」，范围定死为只判"说完了没有"）。以下选型留作将来要做时的候选。

### sherpa-onnx keyword spotting — 推荐

- 仓库 <https://github.com/k2-fsa/sherpa-onnx>，**Apache-2.0**（官方 README，2026-08-09）。商用无障碍。最后提交 2026-08-08，活跃。
- 机制：开放词表 KWS，官方描述"just like a tiny ASR system, but it can only decode words/phrases in the given keywords"，**改关键词不用重训**（官方文档 <https://k2-fsa.github.io/sherpa/onnx/kws/index.html>，2026-08-09）。用 `sherpa-onnx-cli text2token` 把关键词转成 token，每个关键词单独配 boosting score 和 trigger threshold 来平衡漏检/误唤醒。
- 模型（官方文档 <https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html>，2026-08-09）：

  | 模型 | 语言 | encoder | decoder | joiner | int8 |
  |---|---|---|---|---|---|
  | zipformer-zh-en-3M-2025-12-20 | 中+英 | 12 MB | 0.743 MB | 0.331 MB | encoder/joiner 有 |
  | zipformer-wenetspeech-3.3M-2024-01-01 | 中 | 12 MB | 0.66 MB | 0.248 MB | 全有 |
  | zipformer-gigaspeech-3.3M-2024-01-01 | 英 | 12 MB | 1.1 MB | 0.628 MB | 全有 |

  中英双语那个是 2025-12 的新模型，总计约 13MB，int8 后更小。参数量 3M，比 docs/27 提到的流式 ASR Zipformer（int8 encoder 154MB）小一个数量级。
- iOS：仓库有 `xcframework` release，最新 2026-07-31（GitHub releases API，2026-08-09）。Swift API 里有 `keyword-spotting-from-file.swift`（`swift-api-examples/`，源码，2026-08-09）——**示例是文件输入不是麦克风流**，但 KeywordSpotter 的 C API 本身是流式的，接麦克风要自己写。官方 iOS 文档页只讲 ASR demo，没有 KWS 的 iOS 教程（<https://k2-fsa.github.io/sherpa/onnx/ios/>，2026-08-09）。
- WASM：仓库有 `wasm/kws/` 构建目标，含 `sherpa-onnx-wasm-main-kws.cc`、`app.js`、`index.html`（GitHub contents API，2026-08-09）。**但官方 WASM 文档页只列了 ASR 的三四个 build，没有 KWS 页**——构建目标存在，文档缺失，得自己编。
- CPU 占用和耗电：**未查证**，官方没给 KWS 的 RTF 数字。参照同家族 3M 参数模型，量级上应远低于流式 ASR 的 RTF 0.15（docs/27 记录）。
- 误唤醒率：**未查证**，官方无 benchmark。

### Picovoice Porcupine — 中文支持好，但商务上是坑

- 仓库 <https://github.com/Picovoice/porcupine>，仓库 LICENSE 是 Apache-2.0（2026-08-09）。**但这只覆盖 binding 源码**：运行必须持有 Picovoice Console 签发的 AccessKey，模型是 Console 生成的 `.ppn` + `porcupine_params.pv`（官方 README，2026-08-09）。没有 key 就跑不起来，Apache-2.0 在这里不代表你能自由商用。
- 语言：官方 README 明确列出 "English, Chinese (Mandarin), French, German, Italian, Japanese, Korean, Portuguese, and Spanish"，中文是一等公民（2026-08-09）。
- 平台：Web（Chrome/Edge/Firefox/Safari）、iOS、Android、MCU 全覆盖。Web binding 依赖 WebAssembly + Web Workers + IndexedDB；**无 `SharedArrayBuffer` 时多线程关闭、性能下降**，Safari 属于这一类（官方 README `binding/web/`，2026-08-09）。
- **价格：查不到公开数字。** <https://picovoice.ai/pricing/> 抓不到内容（JS 渲染）。官方 FAQ 原文（<https://picovoice.ai/docs/faq/general/>，2026-08-09）："Picovoice is a B2B company focused on on-device AI tools for enterprises. At this time, there are no dedicated free or paid plans for personal or non-commercial use."，以及 Free Trial "is a one-time offer, and it doesn't renew automatically once the trial ends"，到期前要 contact sales。
- 判断：**能用但要谈价，且价格未知**。对一个个人做的 NC 授权软件，这是不可控风险。除非 sherpa-onnx 的中文唤醒实测过不了关，否则不碰。
- 模型体积：官方未公布（未查证）。

### openWakeWord — 不能用

- <https://github.com/dscripka/openWakeWord>（2026-08-09）。代码 Apache-2.0，但**预训练模型是 CC BY-NC-SA 4.0**（因训练数据授权限制）。NC 对我们其实不冲突（本项目也是 NC），但 SA 传染性是问题。
- 决定性的一条：官方 README **只支持英文**——"Currently, openWakeWord only supports English, primarily because the pre-trained text-to-speech models used to generate training data are all based on english datasets."
- 无 iOS 支持，无 WASM；官方 FAQ 只给"浏览器采音 + WebSocket 送到 Python 后端"的绕法。

### iOS 原生唤醒词

- **没有第三方唤醒词 API。** 系统只有 "Hey Siri"，第三方 app 注册不了自己的唤醒词。这条是行业共识，Apple 也没有对应框架（证据强度：无反证，官方文档里找不到任何相关 API）。
- 唯一的语音入口是 App Intents / App Shortcuts：定义 `AppShortcutPhrase`，用户说 "Hey Siri, <短语>" 触发（<https://developer.apple.com/documentation/appintents/app-shortcuts>，2026-08-09）。**"短语必须包含 app 名"这条我没抓到官方原文**（Apple 文档站 JS 渲染，JSON 接口里没有 discussion 段）——标记为未查证，但普遍做法是这样。
- 作为替代入口它不够：走 Siri 意味着中断我们自己的音频会话、跳一次系统 UI、且不能带上下文（"刚才那条是什么意思"这种指代 Siri 传不进来）。可以当"启动播报"的快捷方式，不能当"播报中插话"的手段。

### 一直开着 ASR 做关键词匹配

- 耗电数字：**未查证**，没找到可引用的实测。
- 但有一条官方表态支持"别这么干"：iOS 26 的 `SpeechDetector` 文档说它的存在就是为了 "saving power otherwise used by attempting to transcribe what is likely to be silence"，并且 `SensitivityLevel` 明说是"省电 vs 转写准确度"的取舍（<https://developer.apple.com/documentation/speech/speechdetector>，2026-08-09）。Apple 自己把 VAD 门控当省电手段，说明常开 ASR 的功耗是真问题。
- 工程上正确的形状是三级：VAD（永远开，最便宜）→ KWS（VAD 报有声才跑）→ ASR（KWS 命中才起）。别让 ASR 常驻。

---

## 2. VAD

### Silero VAD — 首选

- <https://github.com/snakers4/silero-vad>，**MIT**，官方 README 原话 "Published under permissive license (MIT) Silero VAD has zero strings attached - no telemetry, no keys, no registration, no built-in expiration"（2026-08-09）。商用无障碍。最后提交 2026-07-16。
- 体积：JIT 模型约 2MB。延迟：官方 "One audio chunk (30+ ms) takes less than 1ms to be processed on a single CPU thread"，ONNX runtime 下"可能再快 4–5 倍"。
- 采样率 8k/16k。训练覆盖 6000+ 语言，语言无关。
- ONNX 支持，配 C++/Rust/Java/C#/Go 示例；浏览器路径官方指向社区项目。

### @ricky0123/vad-web — 浏览器封装，有 Safari 坑

- <https://github.com/ricky0123/vad>，**ISC**（模型文件本身 MIT，Silero Team）（2026-08-09）。商用无障碍。
- 跑 Silero VAD on ONNX Runtime Web，仓库里同时带 `silero_vad_legacy.onnx` 和 `silero_vad_v5.onnx`。最新 `@ricky0123/vad-web` v0.0.30，2025-11-21 发布；最后提交 2026-01-30——**半年没动了**。
- **Safari 坑（这条直接影响 WKWebView）**：issue #157 "VAD-WEB error on safari : SIMD not supported in the current environment"，报错说 WASM backend 和 CPU fallback 都初始化失败。2024-11-18 开的，至今 open，无维护者回应、无 workaround（<https://github.com/ricky0123/vad/issues/157>，2026-08-09）。
  - 注意这条报告的日期比较老，Safari 的 WASM SIMD 支持这两年在推进，现在的 iOS 版本上未必还复现——但**这个封装没有 fallback 路径是确定的**，上之前必须在真机 WKWebView 里验。

### TEN VAD — 性能更好，license 有非竞争条款

- <https://github.com/TEN-framework/ten-vad>（2026-08-09）。库体积 306KB(Linux) / 731KB(macOS M1) / Web 277KB，RTF 0.0086–0.0160，Web 上 0.010（M1）。平台覆盖 iOS(arm64，不含模拟器)、Android、WASM。
- 官方称比 Silero 精度更好，且"TEN VAD rapidly detects speech-to-non-speech transitions, whereas Silero VAD suffers from a delay of several hundred milliseconds"——**收尾延迟低几百毫秒**，对打断响应是实打实的收益。
- License：Apache-2.0 **加附加条款**（Agora 版权）。关键限制原文："You may not Deploy the ten-vad in a way that competes with Agora's offerings and/or that allows others to compete with Agora's offerings, including without limitation enabling any third party to develop or deploy Applications."
  - 判断：陪读 app 不是 RTC 产品，不构成与声网竞争，**大概率可用**；但这是非标准条款，不是律师看不了准。要用就在 docs 里记一笔，别当成普通 Apache-2.0。
- 另外 sherpa-onnx 已经集成了 ten-vad（`run-generate-subtitles-ten-vad.sh`，源码，2026-08-09），如果本来就上 sherpa-onnx，这条路是顺的。

### iOS 原生 VAD

- **有，iOS 26 起**：`SpeechDetector`，官方描述 "A module that performs a voice activity detection (VAD) analysis"，"asks 'is there speech?'"，可调 `SensitivityLevel`（<https://developer.apple.com/documentation/speech/speechdetector>，2026-08-09）。
- **限制致命**：官方明说 "only functions in conjunction with a `SpeechTranscriber` or `DictationTranscriber` module"——它是 SpeechAnalyzer 管线里的一个门控模块，**拿不到独立的 VAD 事件流**。当不了通用 VAD。
- `SoundAnalysis` 的 `SNClassifySoundRequest` 有内置分类器（`SNClassifierIdentifier.version1`），但是否含 speech 类别官方页面没写，要查 `knownClassifications`（<https://developer.apple.com/documentation/soundanalysis/snclassifysoundrequest>，2026-08-09，未查证）。它是分类器不是 VAD，粒度和延迟都不对。
- 结论：iOS 原生 VAD 不可用于我们的场景，走 Silero 或 TEN。

---

## 3. 轮次检测

docs/27 的记录（"Pipecat 的 smart-turn 是 int8 8MB，CPU 上约 10ms，覆盖普通话"，2026-07 查证）**今天依然成立，且可以补细**：

- 仓库 <https://github.com/pipecat-ai/smart-turn>，**BSD 2-clause**，官方 README 原话 "a truly open model (BSD 2-clause license)"（2026-08-09）。商用无障碍。最后提交 2026-01-29。
- 最新版本 **v3.2**。底座是 Whisper Tiny + 一个线性分类头，8M 参数。CPU 版 8MB int8 量化，GPU 版 32MB 未量化（官方 README，2026-08-09）。
- 实测体积：pipecat 主仓库里 bundle 的 `smart-turn-v3.2-cpu.onnx` 是 **8,679,182 字节 ≈ 8.28 MB**（GitHub contents API，2026-08-09）。
- 推理：官方 "Runs in as little as 10ms on some CPUs, and under 100ms on most cloud instances"。HuggingFace 模型页配的博客标题写 "CPU inference in just 12ms"（<https://huggingface.co/pipecat-ai/smart-turn-v3>，2026-08-09）。10ms 是最好情况，别当预算。
- 语言：官方列 23 种，**含 Chinese**。
- **格式是纯 ONNX**（8MB int8 / 32MB fp32），HuggingFace 页面无 CoreML。pipecat 里 `local_smart_turn_v3.py` 直接 `import onnxruntime as ort` 跑 `InferenceSession`（源码，2026-08-09）。
- 端上可行性：
  - **iOS**：ONNX Runtime 有官方 iOS 包，8MB int8 模型跑得动。但 pipecat 官方没有 iOS 实现，要自己接（Rust 侧 `ort` crate，或 Swift）。仓库里另有 `local_coreml_smart_turn.py`，说明 CoreML 路线在 v1/v2 存在过，**v3 有没有 CoreML 未查证**。
  - **WASM**：ONNX Runtime Web 理论可行，无人做过，未查证。8MB 模型加载到 webview 里每次冷启动的代价要量。
- 其它方案：**没查到第二个开源的学习式轮次检测模型**。商业侧 LiveKit / Deepgram 等都有自己的 turn detection，但没走公开抓取核实（未查证）。
- 实用判断：轮次检测是"锦上添花"。第一版用 VAD + 静音超时也能跑（代价是 docs/27 说的那将近一秒），smart-turn 可以放到第二轮。它不是外放场景成不成立的关键——AEC 才是。

---

## 4. 回声消除（AEC）—— 决定外放场景成败

### 4.1 WKWebView 的 `getUserMedia({audio:{echoCancellation:true}})` 给不给真 AEC

**给。证据是 WebKit 源码，强度最高。**

`Source/WebCore/platform/mediastream/cocoa/CoreAudioCaptureUnit.cpp`（2026-08-09 抓取）：

```cpp
static Expected<CoreAudioCaptureUnit::StoredAudioUnit, OSStatus> createAudioUnit(bool shouldUseVPIO)
{
    OSType unitSubType = kAudioUnitSubType_VoiceProcessingIO;
    if (!shouldUseVPIO) {
#if PLATFORM(MAC)
        unitSubType = kAudioUnitSubType_HALOutput;
#else
        unitSubType = kAudioUnitSubType_RemoteIO;
#endif
    }
```

同文件 `m_shouldUseVPIO = enableEchoCancellation();`。`BaseAudioCaptureUnit.h` 里 `bool m_enableEchoCancellation { true }`——**默认开**。

`CoreAudioCaptureSource.cpp`：
```cpp
m_unit = echoCancellation() ? Ref { CoreAudioCaptureUnit::defaultSingleton() } : CoreAudioCaptureUnit::createNonVPIOUnit();
```
以及 `supportedConstraints.setSupportsEchoCancellation(true)`。

所以：`echoCancellation: true` → **Voice-Processing I/O audio unit**；`false` → iOS 上退成 RemoteIO。约束是真接线的，不是摆设。

会话侧也对：`Source/WebCore/platform/audio/ios/AudioSessionIOS.mm` 采集时把 category 设成 `AVAudioSessionCategoryPlayAndRecord`，mode 设成 `AVAudioSessionModeVideoChat`（若 `isReceiverPreferredSpeaker()` 则 `AVAudioSessionModeVoiceChat`），并带 `AVAudioSessionCategoryOptionDefaultToSpeaker`。

对照 Apple 官方文档（<https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/voicechat>，2026-08-09），voiceChat 一节最后一段是关键：

> "For apps that use one or more chat modes (voice, video, or game), but don't use Audio Unit Voice I/O or AVAudioEngine with `setVoiceProcessingEnabled(_:)`, the system reduces the processing it applies to audio signals. Specifically, it doesn't apply voice-specific processing, like echo cancellation and automatic gain correction..."

**AEC 来自 VPIO audio unit，不来自 mode。** WebKit 两样都做了，所以链路完整。

### 4.2 但参考信号只接了一条路 —— 这是真正的风险点

VPIO 的 AEC 需要"扬声器正在播什么"作为参考。WebKit 里这个参考由 `CoreAudioSpeakerSamplesProducer` 提供。GitHub code search 全仓库只有一个实现者（2026-08-09）：

```
Source/WebKit/GPUProcess/webrtc/RemoteAudioMediaStreamTrackRendererInternalUnitManager.cpp
class RemoteAudioMediaStreamTrackRendererInternalUnitManagerUnit
    : public WebCore::CoreAudioSpeakerSamplesProducer
```

也就是说，**只有从 MediaStreamTrack 渲染出来的音频**（WebRTC 远端音频、`<audio>.srcObject = MediaStream`）会被送进 VPIO 的 output bus 当参考信号。普通的 `<audio src="...">`、`AudioContext.destination` 直接输出，走的是 WebKit 的媒体播放栈，**不经过这个 producer**。

推论（证据强度：源码推断，需真机验证）：
- 如果我们的 TTS 用 `<audio>` 或 Web Audio 直接播，**AEC 可能拿不到参考信号，外放时模型会听见自己**。
- iOS 上 VPIO 有没有系统级的声学回声参考兜底（不靠 output bus，而靠 OS 知道整机在播什么）——**Apple 官方文档没有明说，未查证**。经验上 iOS 的 VPIO 比 macOS 强，但不能假设。

同文件里还有一条旁证，说明 WebKit 对"不在参考路径里的音频"的处理方式是**ducking 而不是 cancel**：

```cpp
AUVoiceIOOtherAudioDuckingConfiguration configuration { true, kAUVoiceIOOtherAudioDuckingLevelMin };
m_ioUnit->set(kAUVoiceIOProperty_OtherAudioDuckingConfiguration, ...);
```

Apple 对该结构的定义（<https://developer.apple.com/documentation/audiotoolbox/auvoiceiootheraudioduckingconfiguration>，2026-08-09）："A structure that you use to configure ducking of other non-voice audio in a voice chat"，"Advanced ducking ducks other non-voice audio based on the presence of voice activity from local and remote chat participants."

WebKit 开了 advanced ducking 但把等级设成 `Min`。含义：其它音频会在检测到人声时被压低一点，但**不是被消除**。

### 4.3 该怎么做

**做法 A（推荐，先验这个）：把 TTS 播放绕进 MediaStream 路径。**
```
TTS 音频 → AudioContext → createMediaStreamDestination() → <audio>.srcObject
```
这样播放走的是 MediaStreamTrack renderer，正好是唯一注册为 `SpeakerSamplesProducer` 的那条路，AEC 拿得到参考信号。注册条件是 `m_canUseCaptureUnit && connection->isLastToCaptureAudio() && shouldAudioCaptureUnitRenderAudio()`（源码，2026-08-09），也就是**必须同时在采集**——我们的场景本来就是边播边听，条件满足。

这条路没有公开文档背书（未查证），但源码逻辑是清楚的，**值得作为第一个真机实验**：外放最大音量播 TTS，同时看 VAD 会不会被自己触发。

后台和锁屏下这条链活不活，见 §7——结论是活，但有两个必须遵守的写法。

**做法 B（原生兜底）：录音走 Rust/Swift 侧，不走 webview。**
用 `AVAudioEngine` + `setVoiceProcessingEnabled(true)`（iOS 13.0+，<https://developer.apple.com/documentation/avfaudio/avaudioionode/setvoiceprocessingenabled(_:)>，2026-08-09），或直接建 `kAudioUnitSubType_VoiceProcessingIO` audio unit（<https://developer.apple.com/documentation/audiotoolbox/kaudiounitsubtype_voiceprocessingio>，2026-08-09："An audio unit that interfaces to the audio inputs and outputs of iOS devices and provides voice processing features"，bus 0 输出 / bus 1 输入）。播放也放到原生侧同一个 VPIO 的 output bus。这样参考信号百分之百正确。
代价：音频路径整体离开 webview，和 docs/27 "回声消除只有 webview 给"的现有结论相反，工程量大。只在做法 A 验失败时才上。

**做法 C（半双工兜底）：播的时候不听。**
小智的做法就是这个层级——`github.com/78/xiaozhi-esp32`（MIT，2026-08-09）README 原话 "AEC-capable hardware supports realtime full-duplex interaction"，即**没有硬件 AEC 就没有全双工**，唤醒词（ESP-SR）+ SileroVAD 是它的常规路径。
半双工的具体形状：播报时只跑唤醒词（KWS 对自己的 TTS 有一定鲁棒性，因为它只匹配特定词），命中后立即停播再开全量 ASR。或者播报时把麦克风增益压低。
这条路**一定能work**，只是打断要多说一个唤醒词。作为第一版是可接受的，也和"手湿不能点屏幕"的需求兼容。

### 4.4 外放实际效果

**未查证。** 没找到 iOS VPIO 在外放（免提、设备放在台面上）场景下的可引用实测报告。可以说的：
- VPIO 是 iOS 上所有 VoIP app（含 FaceTime 免提）用的同一套东西，免提通话在 iOS 上体验是可用的——**这是间接证据，不是我们场景的实测**。
- 我们的场景比 VoIP 更难：TTS 是连续长语音（不像对话有天然停顿），用户说话音量可能很小（刷牙、嘴里有东西），距离可能有一米。
- 必须真机实测。测法：外放最大音量播一段 TTS，同时看采集到的信号里残留回声的电平，和 VAD 的误触发率。

### 4.5 AirPods 场景

**大概率不是问题，但不是没问题。**
- 麦克风在耳机上，扬声器也在耳机上，物理泄漏路径短且封闭度高，回声电平比外放低很多。
- 但 AirPods 走 HFP 时有明显的**播放延迟**，AEC 的参考信号对齐窗口要更宽——这正是 VPIO 该处理的事。
- HFP 下麦克风走窄带链路，**ASR 质量会掉**。这是 AirPods 场景真正要注意的坑，不是 AEC。规避办法见 §7.4——结论是 webview 里规避不了。
- 无实测（未查证）。

### 4.6 iOS 18.2 的 `prefersEchoCancelledInput`（原生侧才有，且我们用不上）

`AVAudioSession.setPrefersEchoCancelledInput(_:)`，iOS 18.2+，"Sets a preference to enable echo-canceled input on supported hardware"，专门针对"内置麦克风 + 内置扬声器同时收发"（<https://developer.apple.com/documentation/avfaudio/avaudiosession/setprefersechocancelledinput(_:)>，2026-08-09）。和 VPIO 的区别是它"tuned for capturing a wider range of audio signals in the presence of built-in speaker echo"，不是为人声调的。

用不上的三个理由（都来自同一份官方文档）：只支持 `playAndRecord` **且 mode 必须是 `default`**（我们是 VideoChat mode）；路由只能是内置麦 + 内置扬声器，切到耳机就失效；仅"certain 2024 or later iPhone models"，要先查 `isEchoCancelledInputAvailable`。webview 里也完全够不着。记一笔备查。

---

## 7. 后台与锁屏（第二轮核实，2026-08-09）

针对"AudioContext 进后台被挂起"的冲突，按 WebKit 源码逐条核实。结论：**冲突不成立，但队友引的那句 bugzilla 原文也不是化解它的理由**——真正的豁免条件是另外两条。

### 7.1 Q1：后台时 AudioContext 保不保持 running

**保持，但条件不是"正在采集"。** 拆成三步看。

**第一步，iOS 确实对 WebAudio 加了后台限制。** `Source/WebCore/platform/audio/ios/MediaSessionManagerIOS.mm`（2026-08-09）：

```cpp
addRestriction(PlatformMediaSession::MediaType::Video, MediaSessionRestriction::BackgroundProcessPlaybackRestricted);
addRestriction(PlatformMediaSession::MediaType::WebAudio, MediaSessionRestriction::BackgroundProcessPlaybackRestricted);
addRestriction(PlatformMediaSession::MediaType::VideoAudio, { ConcurrentPlaybackNotPermitted, BackgroundProcessPlaybackRestricted, SuspendedUnderLockPlaybackRestricted });
```

app 进后台时 `MediaSessionManagerInterface`（同日）对带该 restriction 的 session 调 `beginInterruption(EnteringBackground)`。WebAudio 在列，所以默认会被中断——bug 237878 描述的现象有源码依据。

顺带一条：`MediaType::Audio`（纯音频的 `<audio>` 元素）**不在这三行里**，也没有 `SuspendedUnderLockPlaybackRestricted`。普通 `<audio>` 音频在 iOS 上本来就不受后台播放限制。

**第二步，中断可以被 client 否决。** `Source/WebCore/platform/audio/PlatformMediaSession.cpp`（2026-08-09）：

```cpp
if (protect(client())->shouldOverrideBackgroundPlaybackRestriction(type)) {
    ALWAYS_LOG(LOGIDENTIFIER, "returning early because client says to override interruption");
    m_interruptionStack.append({ type, true });
    return;
}
```

**第三步，AudioContext 的否决条件有两条**（`Source/WebCore/Modules/webaudio/AudioContext.cpp`，2026-08-09）：

```cpp
bool AudioContext::shouldOverrideBackgroundPlaybackRestriction(PlatformMediaSession::InterruptionType interruption) const
{
    if (interruption != PlatformMediaSession::InterruptionType::EnteringBackground)
        return false;
    if (m_canOverrideBackgroundPlaybackRestriction && !destination().isConnected())
        return true;
    ...
    return hasPlayBackAudioSession(document.get());
}
```

`m_canOverrideBackgroundPlaybackRestriction` 初值 true（`AudioContext.h:175`）。

**`document.isCapturing()` 不在这里面。** 它只出现在 `shouldDocumentAllowWebAudioToAutoPlay()`：

```cpp
static bool shouldDocumentAllowWebAudioToAutoPlay(const Document& document)
{
    if (document.isCapturing())
        return true;
    ...
}
```

管的是**免用户手势自动播放/恢复**，不是后台豁免。bugzilla 那句 "AudioContext might be resumed by web page in case it can autoplay (for instance if page is continuing to capture audio...)" 说的正是这个 autoplay 授权——它让页面**有权在后台调 `resume()`**，但不阻止系统先把它挂起。**不能靠这条**。

**真正能用的是另外两条，而且我们两条都能占：**

**豁免 A：不连 `ctx.destination`。** `destination()` 是 `DefaultAudioDestinationNode`，`isConnected()` 就是看它的 input 有没有连接（`DefaultAudioDestinationNode.cpp:72`）。我们的 TTS 图只连到 `createMediaStreamDestination()` 返回的节点，从不连 `ctx.destination`，所以恒为 false，`EnteringBackground` 直接被 ignore。

这不会让图停转。`MediaStreamAudioDestinationNode` 继承 `AudioBasicInspectorNode`，`updatePullStatus()` 里：下游没连东西但上游有输入时，节点被加进 context 的 **automatic pull list**（`AudioBasicInspectorNode.cpp`，2026-08-09），由 destination 的 render 回调驱动照样渲染。硬件输出 bus 全静音，`setIsSilent(true)` → 这个 AudioContext 在 now-playing 里不算"在播音频"，也没关系，出声的是 `<audio>` 元素。

注意 `defaultDestinationWillBecomeConnected()`：一旦有东西连上 `ctx.destination`，WebKit 会立刻补一次 `beginInterruption(EnteringBackground)`。所以这是硬约束——**代码里不许出现 `.connect(ctx.destination)`**，加个 lint 或封装死。

**豁免 B：`navigator.audioSession.type = "play-and-record"`。** `hasPlayBackAudioSession()` 的判据（`AudioContext.cpp:577`）：

```cpp
Ref audioSession = NavigatorAudioSession::audioSession(*navigator);
return audioSession->type() == DOMAudioSessionType::Playback || audioSession->type() == DOMAudioSessionType::PlayAndRecord;
```

这个 API 是真的在 iOS 上开着的：`UnifiedWebPreferences.yaml`（2026-08-09）里 `DOMAudioSessionEnabled` 是 `status: mature`，`WebKit: default: true`。

**必须是 `"play-and-record"`，不能是 `"playback"`。** `DOMAudioSession.cpp`（2026-08-09）把 type 映射成 category 后调 `AudioSession::singleton().setCategoryOverride(...)`，而 `MediaSessionManagerCocoa::updateSessionState()` 里 categoryOverride **优先级最高**：

```cpp
if (sharedSession->categoryOverride() != AudioSession::CategoryType::None)
    category = sharedSession->categoryOverride();
else if (captureCount || ...) {
    category = AudioSession::CategoryType::PlayAndRecord;
    mode = AudioSession::Mode::VideoChat;
}
...
if (mode == AudioSession::Mode::Default && category == AudioSession::CategoryType::PlayAndRecord)
    mode = AudioSession::Mode::VideoChat;
```

设 `"playback"` 会把 category 顶成 MediaPlayback，直接废掉麦克风采集。设 `"play-and-record"` 则最后那个 if 把 mode 补成 VideoChat，AEC 链路不受影响。

**播放端也有专门豁免，而且覆盖锁屏。** `Source/WebCore/html/HTMLMediaElement.cpp`（2026-08-09），同一段代码在 `EnteringBackground` 和 `SuspendedUnderLock` 两个分支里各出现一次：

```cpp
if (hasMediaStreamSrcObject() && mediaState().containsAny(MediaProducerMediaState::IsPlayingAudio) && document().mediaState().containsAny(MediaProducerMediaState::HasActiveAudioCaptureDevice)) {
    INFO_LOG(LOGIDENTIFIER, "returning true because playing an audio MediaStreamTrack");
    return true;
}
```

**"播 MediaStream 音频 + 文档有活跃音频采集设备" = 后台和锁屏都豁免。** 这正好是我们的形态。WebKit 是特意为这个组合写的。

**"页面 hidden"这条路今天不存在。** `PlatformMediaSessionInterruptionType` 枚举里有 `PageNotVisible`（`PlatformMediaSessionTypes.h:82`），但全仓库代码搜索只在枚举定义和序列化描述文件里出现，**没有任何使用点**（GitHub code search，2026-08-09）。当前 WebKit 没有"页面不可见就中断媒体会话"的机制。bug 237878 里用户报到 iOS 16.3 的现象，在今天的代码里找不到对应路径。

**Q1 答案：** app 进后台时 AudioContext 保持 running，条件是（1）不连 `ctx.destination`，或（2）设 `navigator.audioSession.type = "play-and-record"`。两条都做。"正在采集"本身不是豁免条件，它只解决 autoplay 授权。播放端的 `<audio srcObject>` 另有明写的后台+锁屏豁免，条件里恰好包含"文档正在采集音频"。

**仍需真机验的**（源码只能证明设计意图，不能证明当前 iOS 版本的实际行为）：后台 30 分钟不掉；锁屏后仍出声且仍能被打断；`ctx.destination` 意外被连上时的降级表现。

### 7.2 Q2：绕开 AudioContext 的办法

**没有。三条都堵死。**

- **`HTMLMediaElement.captureStream()`：WebKit 未实现。** 全仓库搜 `captureStream` 只命中 `HTMLCanvasElement.cpp` / `HTMLCanvasElement.idl` 和一堆 canvas 的 LayoutTests，`HTMLMediaElement.cpp` 零命中（GitHub code search + 本地 grep，2026-08-09）。Safari 上这个 API 不存在。
- **`RTCPeerConnection` 本地 loopback：能进参考路径，但没必要。** 远端音频轨确实是 `RemoteAudioMediaStreamTrackRendererInternalUnitManagerUnit` 的原生形态，一定注册为 `SpeakerSamplesProducer`。但既然 §7.1 已经证明 `createMediaStreamDestination()` 那条路后台也活着，loopback 只是多付代价：一次 Opus 编解码（音质损失 + 20ms 级延迟）、一套 SDP 协商、一个常驻 PeerConnection 的电量开销。**不推荐**，留作备选。
- **别的构造可播放 MediaStreamTrack 的 API：没有。** `MediaStreamTrackGenerator`（Breakout Box / WebCodecs）Safari 不支持；`canvas.captureStream()` 只出视频轨；`MediaRecorder` 是反方向。

所以 `AudioContext → createMediaStreamDestination() → <audio>.srcObject` **是 webview 里唯一的路**，好在它成立。

### 7.3 Q3：要不要退到全原生

**不用。** Q1 的答案是"后台能活"，Q2 虽然没有备选但主路可行，所以 §4.3 的做法 A 依然是首选，做法 B（全原生）降级为兜底。

判断的成立条件（任一被真机推翻就要重估）：
1. 不连 `ctx.destination` 时 AudioContext 后台不被中断。
2. `<audio srcObject>` + 活跃采集在锁屏下继续出声。
3. `createMediaStreamDestination()` 的输出真的进了 VPIO 的 AEC 参考路径（这条是 §4.2 遗留的、优先级最高的未验项）。

做法 B 的工程量（若真要上）：Rust/Swift 侧建一个 VPIO audio unit，采集和播放共用；TTS 音频从 webview 通过 Tauri command 或 IPC 流式送到原生侧播放（要处理背压和分块）；采集到的 PCM 反向送回 webview 或直接在原生侧接 VAD/KWS；音量、路由变化、中断（来电）、后台生命周期全部自己管。**这是把整条音频链路从 webview 搬到原生**，不是加个模块。粗估两周起，且 docs/27 "回声消除只有 webview 给"那条共识要重写。**只在上面三条被推翻后才动。**

### 7.4 Q4：AirPods 的 HFP 窄带能不能规避

**webview 里规避不了。三条分别答：**

**(a) 混合路由（播放走 A2DP、采集走本机麦）——iOS 明确不给。**

WebKit 对 PlayAndRecord 硬编码这组 options（`AudioSessionIOS.mm`，2026-08-09）：

```cpp
options |= AVAudioSessionCategoryOptionAllowBluetooth | AVAudioSessionCategoryOptionAllowBluetoothA2DP | AVAudioSessionCategoryOptionAllowAirPlay;
// 若非 receiver-preferred，再加：
options |= AVAudioSessionCategoryOptionDefaultToSpeaker;
```

两个都设了。Apple 官方文档对这种情况有明写的仲裁规则（<https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp>，2026-08-09）：

> "If both `allowBluetoothA2DP` and the `allowBluetooth` option are set, when a single device supports both the Hands-Free Profile (HFP) and A2DP, the system gives hands-free ports a higher priority for routing."

AirPods 两个 profile 都支持 → **系统必选 HFP**。同页还说 A2DP 是 "a stereo, output-only profile"，`record` / `multiRoute` category 会隐式清掉它。

要规避只能**不设** `allowBluetooth`(HFP)、只留 A2DP，再 `setPreferredInput` 到内置麦。**web 内容没有任何 API 能改这组 options**——`navigator.audioSession.type` 只选 category，options 由 WebKit 从 category 推导。

半个例外：输入设备**可以**从 web 侧影响。getUserMedia 的 `deviceId` 约束会一路走到 `AVAudioSessionCaptureDeviceManager::setPreferredMicrophoneID()` → `[AVAudioSession setPreferredInput:]`（`AVAudioSessionCaptureDeviceManager.mm` + `AudioSessionIOS.mm`，2026-08-09）。理论上可以枚举 `enumerateDevices()` 挑内置麦。但 HFP 的路由优先级是 category-option 级的决定，先于 preferredInput 生效，**选了内置麦会不会把输出踢回 A2DP，未查证**，只能实测。

**(b) 新 AirPods：iOS 26 有专门的高质量录音选项，但我们用不了。**

`AVAudioSession.CategoryOptions.bluetoothHighQualityRecording`，iOS 26.0+（<https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/bluetoothhighqualityrecording>，2026-08-09）。官方原文："Specifying this option enables full-bandwidth audio when the Bluetooth route supports it, such as on certain AirPods models."，可以配合 `allowBluetoothHFP` 作为 fallback，能力查询走 `inputPort.bluetoothMicrophoneExtension.highQualityRecording.isSupported`。

三条限制让它对我们无效：
- **"You can request high-quality recording only when using the `default` audio session mode."** 我们是 VideoChat mode（WebKit 在采集时强制设的），互斥。
- 官方明说 **"This option may increase input latency when enabled and isn't recommended for real-time communication usage."** 我们就是实时通信场景。
- **"Bluetooth high-quality recording isn't currently supported in the European Union."**

而且 WebKit 根本没用它：全仓库搜 `BluetoothHighQualityRecording` 只命中 `WebKitLibraries/SDKDBs/iphoneos/CameraCapture_AVF.partial.sdkdb`（SDK 符号表存根），WebKit 自己的代码零命中（GitHub code search，2026-08-09）。

**(c) webview 能不能影响路由：只能选 category，不能选 options。**

能影响的：`navigator.audioSession.type`（选 category，`playback` / `play-and-record` / `ambient` 等）、getUserMedia 的 `deviceId`（选输入设备）。
写死在 `AudioSessionIOS.mm` 里改不了的：category options（AllowBluetooth / A2DP / AirPlay / DefaultToSpeaker）、mode（PlayAndRecord 必配 VideoChat）、`isReceiverPreferredSpeaker` 的判定。

**Q4 结论：戴 AirPods 时走 HFP 窄带是既定事实，webview 形态下无解。** 应对是产品层的：ASR 端要能吃窄带输入（选模型时把 8k/16k 窄带纳入评估），或者在检测到蓝牙输入路由时提示用户"摘一只耳朵效果更好"。真要拿高质量录音只能整条链路搬原生，而 (b) 的三条限制说明搬了也拿不到——`default` mode 和 VPIO 的 AEC 是互斥的。

---

## 5. 耗电

**没找到可引用的实测数字（未查证）。** 能给的只有量级推断：

- Silero VAD：30ms chunk 单线程 <1ms（官方，2026-08-09），即 RTF < 0.033；TEN VAD RTF 0.0086–0.016（官方，2026-08-09）。VAD 常开在 CPU 上是**个位数百分比的单核占用**，A 系列芯片上更低。这一档的功耗被麦克风硬件本身和音频回调的唤醒频率主导，不是被计算主导。
- KWS（3M 参数 zipformer）：无官方数字。参照同家族流式 ASR RTF 0.15，3M 参数模型应在 0.02–0.05 量级（**推断，未查证**）。只在 VAD 触发后跑，占空比低。
- 常开 ASR：docs/27 记录的流式 Zipformer RTF 约 0.15，等于持续占用约 15% 的一个核。这一档才是真耗电。
- Apple 的间接表态见 §1 末尾（`SpeechDetector` 存在的理由就是省电）。
- **要真数字只能自己测**：Xcode Instruments 的 Energy Log，或 iOS 设置里的电池用量（按 app 统计），跑一小时对照组。

---

## 6. 选型建议

| 层 | 选择 | license | 体积 | 状态 |
|---|---|---|---|---|
| VAD | Silero VAD（保守）或 TEN VAD（响应更快） | MIT / Apache-2.0+非竞争条款 | 2MB / 库 277–731KB | 都可商用 |
| 浏览器 VAD 封装 | `@ricky0123/vad-web` | ISC | — | **Safari SIMD 问题待验**，半年未更新 |
| KWS | sherpa-onnx zipformer-zh-en-3M-2025-12-20 | Apache-2.0 | 约 13MB | iOS 有 xcframework；WASM 有构建目标无文档 |
| 轮次检测 | smart-turn v3.2 ONNX | BSD-2 | 8.28MB | 端上要自己接，可推迟到第二轮 |
| AEC | WKWebView VPIO + TTS 绕 MediaStream | 系统 | — | **参考信号路径需真机验证** |
| 后台/锁屏 | 不连 `ctx.destination` + `audioSession.type='play-and-record'` | 系统 | — | 源码有明写豁免，需真机验证 |

排掉的：openWakeWord（只支持英文）、Porcupine（价格不公开、必须谈销售）、iOS 原生 VAD（`SpeechDetector` 绑死 transcriber）、iOS 原生唤醒词（不存在）。

音频链路的定稿写法见 **§8.5**（依据分散在 §4.2、§7.1、§8.1）。要点：`navigator.audioSession.type = 'play-and-record'`；一个常驻 `<audio srcObject>`，src 设一次不再换；TTS 走 `AudioBufferSourceNode → createMediaStreamDestination()`；代码里不许出现 `.connect(ctx.destination)`；麦克风采集全程活着。

### 下一步该做的实验

1. 真机 WKWebView 里验 AEC 参考路径：`<audio src>` vs `AudioContext → createMediaStreamDestination → srcObject`，外放最大音量，看 VAD 会不会被自己的 TTS 触发。**这一条决定全双工成不成立，优先级最高。**
2. 同一条链在后台放 30 分钟 + 锁屏，验播放不断、采集不断、打断仍然生效。顺带验意外连上 `ctx.destination` 时的降级表现。
3. 真机 WKWebView 里验 `@ricky0123/vad-web` 起不起得来（issue #157 的 SIMD 问题在当前 iOS 版本是否已解）。起不来就改用 ten-vad 的 WASM 构建。
4. sherpa-onnx KWS 的 WASM 构建跑通 + 中文唤醒词误唤醒率实测。如果 WASM 编不出来或性能不行，退到 iOS 侧走 xcframework，用 Tauri command 桥接。
5. 戴 AirPods 时用 `enumerateDevices()` + `deviceId` 约束选内置麦，看输出会不会从 HFP 切回 A2DP（§7.4 的唯一未验规避手段）。
6. §8.5 那套形态整体跑通：句间接力有没有可听的缝、`ctx.currentTime` 到实际出声的偏移量是多少（截断助手消息要用）、注册 AudioWorklet 之后后台豁免是否仍生效。

---

## 8. TTS 播放链路：合并方案核实（第三轮，2026-08-09）

冲突是"按句 mp3 → `<audio src=blob>` 交替接力"（TTS 调研）和"必须走 MediaStreamTrack 才进 AEC 参考路径"（§4.2）。提出的合并方案：

```
每句 TTS 字节 → decodeAudioData → AudioBufferSourceNode
  → connect(ctx.createMediaStreamDestination())
  → 一个常驻 <audio>.srcObject = 那个 MediaStream
```

**成立。** 四个问题逐条按源码答。

### 8.1 Q9：不连 `ctx.destination` 时渲染靠什么驱动

**靠硬件输出回调，而它的启停与连接状态无关。** 这是生死点，所以把整条链贴全。

**创建**：`DefaultAudioDestinationNode::initialize()` → `createDestination()`，无条件建 `AudioDestination`（`DefaultAudioDestinationNode.cpp`，2026-08-09）。

**启动**：`startRendering()` 和 `resume()` 都是直接 `m_wasDestinationStarted = true; m_destination->start(...)`。**全文没有任何一处在 start/stop 前检查 `isConnected()`**。停的只有三条路：`suspend()`（脚本调用或被中断）、`close()`、`uninitialize()`。

**渲染**：硬件回调 → `DefaultAudioDestinationNode::render()` → `AudioDestinationNode::renderQuantum()`（`AudioDestinationNode.cpp`，2026-08-09）：

```cpp
// This will cause the node(s) connected to us to process, which in turn will pull on their input(s),
// all the way backwards through the rendering graph.
AudioBus& renderedBus = protect(input(0))->pull(&destinationBus, numberOfFrames);
...
// Process nodes which need a little extra help because they are not connected to anything, but still need to process.
context().processAutomaticPullNodes(numberOfFrames);
...
m_currentSampleFrame += numberOfFrames;
```

`input(0)->pull()` 因为没有连接返回静音，**然后 `processAutomaticPullNodes` 照跑**。WebKit 自己的注释就是为这种节点写的。

**`MediaStreamAudioDestinationNode` 一定在这个列表里。** 它继承 `AudioBasicInspectorNode`，而后者的构造函数只 `addInput()`，**不加 output**。`updatePullStatus()`：

```cpp
CheckedPtr output = this->output(0);
if (output && output->isConnected()) { ...从自动列表移除... }
else {
    unsigned numberOfInputConnections = input(0)->numberOfRenderingConnections();
    if (numberOfInputConnections && !m_needAutomaticPull) {
        context().addAutomaticPullNode(*this);
        m_needAutomaticPull = true;
    }
    ...
}
```

output 是 null → 恒走 else → 只要有 `AudioBufferSourceNode` 连进来就进自动拉取列表。

**Q9 答案：不连 `ctx.destination` 整条链照常渲染。** 硬件输出 bus 全静音（`setIsSilent(true)`，这个 AudioContext 在 now-playing 里不算"在播音频"），但渲染线程照跑，`ctx.currentTime` 也照走（`m_currentSampleFrame` 每 quantum 累加）——所以用 `ctx.currentTime` 减 `start` 时间算"播到哪个字"是可靠的，后台也不失准。

代价照实记：硬件输出单元一直在跑、一直在输出静音，这份功耗省不掉。数量级上远小于 ASR，可接受。

**三条必须写进代码的注意事项：**

1. **`<audio>` 必须先 `play()` 起来再排队。** `MediaStreamAudioDestinationNode::process()` 是 `m_source->consumeAudio(...)`，往一个 live 的 `MediaStreamAudioSource` 里推。这是直播流不是缓冲队列——**元素还没开始播时渲染出的样本直接丢掉**。开场第一句要么等 `play()` 的 promise resolve，要么提前几百毫秒把元素起起来（此时输出静音，正好也当保活）。
2. **首次 `play()` 要用户手势。** app 里有"开始播报"那一下点击，够用。
3. **`ctx.currentTime` 是渲染位置，不是用户听到的位置。** `<audio srcObject>` 到扬声器之间还有一段播放管线延迟（未查证，量级几十毫秒）。docs/27 要求"把助手消息截断到用户真正听到的位置"，这个偏移要减掉，别直接用 `currentTime`。

### 8.2 Q10：`decodeAudioData` 的开销，以及要不要改用 PCM

**开销不在关键路径上，但改用 PCM 更好。**

`BaseAudioContext::decodeAudioData` 走 `AsyncAudioDecoder`（`BaseAudioContext.cpp:328`，2026-08-09），而 `AsyncAudioDecoder` 的构造是：

```cpp
: m_runLoop(RunLoop::create("Audio Decoder"_s, ThreadType::Audio))
```

**独立的专用线程**，既不是主线程也不是音频渲染线程。所以解码既不卡 UI 也不会让渲染 glitch，最坏情况只是那句话晚出来一点。

底层实现是 `AudioFileReaderCocoa.mm`（2026-08-09），用 `AVAsset` + `AVAssetReader` + `AudioToolbox` 的 `AudioConverter`，另有 `AudioFileOpenWithCallbacks` 的路径。也就是**走 Apple 的系统解码器**，不是 JS/WASM 实现。mp3 在 iOS 上具体走硬件还是软件解码器**未查证**，但几十 KB 的一句话在 A 系列上是毫秒级，后台 CPU 预算完全吃得下。

**但让 TTS 直接返回 PCM 更划算**，理由不是 CPU：

- 省掉一整个异步往返（`decodeAudioData` 返回 promise，多一次线程跳转和一次任务排队），句间接力的时间预算更宽裕。
- 直接 `ctx.createBuffer()` + `copyToChannel()` 就出 `AudioBuffer`，**同步完成**，调度更好排。
- 流式更自然：PCM 可以按任意边界切块，mp3 得等到帧边界，做不到"边收边排"。

代价是带宽：PCM 比 mp3 大一个数量级。念简报这种量级（几分钟语音）在 WiFi/5G 上不构成问题，弱网下要退回 mp3。

**建议：主路 PCM，保留 mp3 解码分支当弱网降级。** 另外建 AudioContext 时可以 `new AudioContext({ sampleRate })` 对齐 TTS 输出采样率，省掉 `AudioBufferSourceNode` 的重采样；但采集侧也在同一个 context 上，两边采样率不一致时总有一次重采样躲不掉，不值得为此纠结。

### 8.3 Q11：假如 Q9 是否定的（不成立，仅备查）

Q9 是肯定的，这一问不触发。万一真机推翻了 §8.1，判断如下：

**选 (a)，不选 (b) 不选 (c)。** §7.1 证明了 `hasPlayBackAudioSession()` 是**独立的第二条豁免**，和 `!destination().isConnected()` 是 `||` 关系。所以"连上 `ctx.destination` + 设 `navigator.audioSession.type = 'play-and-record'`"同样能躲开 `EnteringBackground` 中断，AEC 参考路径也不受影响（TTS 仍然从 MediaStreamDestination 出，`ctx.destination` 那一路可以接一个增益为 0 的分支纯粹用来维持连接）。代价只是多一条静音支路。

(b) 退半双工是产品降级，(c) 全原生是两周起的重写，都不该在还有 (a) 的时候动。

### 8.4 Q12：麦克风接进同一个 AudioContext 做 VAD/KWS

**可以，同一个 AudioContext 没问题，AudioWorklet 在后台也跑。但有两个真坑。**

**跑不跑**：`AudioWorkletNode::updatePullStatus()`（`AudioWorkletNode.cpp`，2026-08-09）：

```cpp
bool hasConnectedOutput = false;
for (unsigned i = 0; i < numberOfOutputs(); ++i) {
    if (output(i)->isConnected()) { hasConnectedOutput = true; break; }
}
// If no output is connected, add the node to the automatic pull list.
if (!hasConnectedOutput)
    context().addAutomaticPullNode(*this);
else
    context().removeAutomaticPullNode(*this);
```

**输出不接任何东西的 AudioWorkletNode 会被加进自动拉取列表**，和 `MediaStreamAudioDestinationNode` 同一个机制、同一个驱动。所以 `createMediaStreamSource(micStream) → AudioWorkletNode`（输出悬空）每个 render quantum 都会跑，后台照跑——和 Q9 同源，Q9 成立它就成立。这也意味着半双工兜底（播报时跑 KWS）能和播放共用一套基建。

**坑一：AudioWorklet 会改变渲染线程。** `DefaultAudioDestinationNode::dispatchToRenderThreadFunction()`：

```cpp
if (RefPtr workletProxy = context().audioWorklet().proxy()) {
    return [workletProxy](Function<void()>&& function) {
        workletProxy->postTaskForModeToWorkletGlobalScope(...);
    };
}
return nullptr;
```

一旦注册了 AudioWorklet，整个图的渲染就从音频设备线程**改派到 worklet global scope 线程**。这不是 bug，但意味着播放链路的实时性从此和 worklet 里的代码耦合——**worklet 里做重活会直接卡住 TTS 播放**。

**坑二：别在 worklet 里跑 ONNX。** 承接坑一：VAD/KWS 推理必须挪出渲染线程。标准做法是 worklet 只做搬运（降采样到 16k、攒帧），把 `Float32Array` 通过 `port.postMessage` 转交给一个普通 Worker，推理在 Worker 里做。SharedArrayBuffer 环形缓冲更省拷贝，但要 COOP/COEP 跨源隔离，Tauri 自定义 scheme 下配起来麻烦，**先用 postMessage 拷贝**——16kHz 单声道每 20ms 一包是 640 字节，拷贝成本可以忽略。

**顺带一个设计上的好处**：后台时定时器被节流，但音频渲染线程不被节流。让渲染线程当时钟去驱动 Worker，比 `setInterval` 可靠。**这条是推断，未实测**——worklet 到 Worker 的 postMessage 在后台的投递时效没查证。

**还需真机验的**：mic 的 `MediaStreamAudioSourceNode` 和播放图共用一个 context 时，采集侧的采样率转换有没有额外延迟；以及注册 AudioWorklet 之后 §7.1 的后台豁免是否仍然生效（渲染线程换了，中断逻辑没换，理论上不受影响，但要验）。

### 8.5 合并后的定稿形态

```js
navigator.audioSession.type = 'play-and-record';   // §7.1 豁免 B
const ctx = new AudioContext();
const dest = ctx.createMediaStreamDestination();
audioEl.srcObject = dest.stream;
await audioEl.play();                              // 必须先起来，之后永不换 src

// 播放：每句 → AudioBuffer（PCM 直接建，或 mp3 走 decodeAudioData）
const src = new AudioBufferSourceNode(ctx, { buffer });
src.connect(dest);                                 // 只连 dest，绝不连 ctx.destination
src.start(nextStartTime);                          // 精确接力
nextStartTime += buffer.duration;

// 采集：同一个 ctx
const mic = ctx.createMediaStreamSource(micStream); // getUserMedia({audio:{echoCancellation:true}})
const worklet = new AudioWorkletNode(ctx, 'frame-forwarder');
mic.connect(worklet);                              // worklet 输出悬空 → 自动拉取
worklet.port.onmessage = e => vadWorker.postMessage(e.data);
```

三条硬约束：代码里不许出现 `.connect(ctx.destination)`；`audioEl` 的 `srcObject` 设一次不再换；麦克风采集必须全程活着（`<audio srcObject>` 的后台/锁屏豁免条件含 `HasActiveAudioCaptureDevice`）。

这个形态同时满足：进 AEC 参考路径（§4.2）、AudioContext 后台豁免（§7.1 豁免 A + B 双保险）、`<audio srcObject>` 后台+锁屏豁免（§7.1）、句间无缝接力、静默期靠常驻 MediaStream 天然保活不用垫无声音频、播放位置用 `ctx.currentTime` 精确到样本。

TTS 调研那边要改的只有一处：**不要 `<audio src=blob:...>` 交替接力，改成一个常驻 `<audio srcObject>` + AudioBufferSourceNode 排队**。"按句合成、按句接力"的整体思路不变，边下边播拿不到的结论也不变（AudioBufferSourceNode 同样要整句到齐才能排，除非 TTS 给 PCM 才能按块排）。

---

## 未查证清单

- Porcupine 的具体商用价格（官方页 JS 渲染抓不到，FAQ 明说要联系销售）。
- Porcupine 模型体积。
- sherpa-onnx KWS 的 CPU 占用 / RTF / 误唤醒率，官方无 benchmark。
- App Shortcut 短语是否强制包含 app 名——Apple 文档站的 JSON 接口没有 discussion 段。
- iOS VPIO 在外放场景的 AEC 实测效果，没有可引用报告。
- iOS VPIO 是否有系统级回声参考兜底（不依赖 audio unit 的 output bus）。
- smart-turn v3 是否有 CoreML 格式（v1/v2 时 pipecat 有 `local_coreml_smart_turn.py`）。
- smart-turn 在 ONNX Runtime Web / WASM 上的可行性，无人做过。
- 麦克风常开 + KWS 的 iPhone 实际耗电数字。
- `SNClassifySoundRequest` 内置分类器是否含 speech 类别。
- 上面所有后台/锁屏结论都来自源码，**当前 iOS 版本的实际行为未实测**。源码证明的是设计意图，不是运行时事实。
- 戴 AirPods 时用 `deviceId` 约束选内置麦，会不会把输出路由从 HFP 切回 A2DP。
- Tauri 打包时 `UIBackgroundModes` 要含 `audio`，且 WKWebView 的媒体会话要能继承——本次没查 Tauri 侧的配置细节（另一份后台音频调研应已覆盖）。
- mp3 在 iOS 上走硬件还是软件解码器（WebKit 用 `AVAssetReader` + `AudioConverter`，具体后端未公开）。
- `<audio srcObject>` 从 MediaStreamAudioDestinationNode 消费样本到实际出声的管线延迟，量级未查证。
- AudioWorklet → Worker 的 `postMessage` 在 app 后台时的投递时效。
- 注册 AudioWorklet 改派渲染线程后，§7.1 的后台中断豁免是否仍生效（逻辑上不相干，未实测）。
- 除 smart-turn 外的开源学习式轮次检测方案（本次 WebSearch 额度耗尽，只能抓已知 URL，覆盖面有限）。
