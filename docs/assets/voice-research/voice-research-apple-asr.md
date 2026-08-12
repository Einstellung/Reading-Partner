# Apple 系统语音识别调研

调研日期 2026-08-09。只读调研，未改仓库、未构建、未开窗口。本 session 的 WebSearch 额度耗尽，外部检索走 WebFetch 直抓已知 URL + DuckDuckGo HTML 端点（`https://html.duckduckgo.com/html/?q=`）+ `gh` CLI（GitHub issue / code search）。

证据强度标注：`官方文档` / `官方源码` / `WWDC` / `官方论坛` / `实测帖` / `社区` / `未查证`。

---

## 1. 版本时间线

iOS 26 于 **2025-09-15** 正式发布，2025-06-09 WWDC 2025 宣布。（社区：https://en.wikipedia.org/wiki/IOS_26，2026-08-09 查）

iOS 27 已在 **WWDC 2026（2026-06-08 至 06-12）** 宣布，同期还有 macOS 27 / iPadOS 27 / watchOS 27 / visionOS 27 / tvOS 27。正式版预计 2026-09 发布，现在（2026-08-09）处于 beta。（社区：https://www.macrumors.com/2026/06/08/wwdc-2026-recap/、https://techcrunch.com/2026/06/09/wwdc-2026-everything-announced-on-siri-ai-os-27-apple-intelligence-and-more/）

iOS 27 的语音相关变化：**Speech 框架没有专门的 WWDC 2026 session**。WWDC 2026 完整 session 列表里没有任何 Speech / SpeechAnalyzer / 听写主题的场次，最接近的是 Siri 系列（"Announcing Apple's next big step for Siri and iPhone"、"Build intelligent Siri experiences with App Schemas"）。（官方：https://developer.apple.com/videos/wwdc2026/）

Speech 框架官方更新日志 **June 2026** 只有两条增量，都是输入侧便利类：（官方文档：https://developer.apple.com/documentation/updates/speech）

- 新增 `AssetInputSequenceProvider` / `CaptureInputSequenceProvider`，直接从文件、asset、麦克风等采集设备取音频。
- 新增 `AnalyzerInputConverter`，把 `AVAudioBuffer` 转成 `AnalyzerInput` 支持的格式。

即 SpeechAnalyzer 这条路在 iOS 27 上是延续加打磨，不是重做。`CaptureInputSequenceProvider` 对我们有用：省掉自己写 AVAudioEngine tap + 格式转换那一段。

WWDC 2026 的 Siri 是 Google Gemini 驱动，且**首发不含中国和欧盟**（社区，MacRumors）——和本项目无关，但说明 Apple 的云端语音路线在国内不可用，更该走设备端。

---

## 2. `SFSpeechRecognizer`（老 API，iOS 10+）

### 形状

```swift
class SFSpeechRecognizer                                  // iOS 10.0+, macOS 10.15+
convenience init?()
convenience init?(locale: Locale)
class func supportedLocales() -> Set<Locale>
class func requestAuthorization(_ handler: (SFSpeechRecognizerAuthorizationStatus) -> Void)
class func authorizationStatus() -> SFSpeechRecognizerAuthorizationStatus
var isAvailable: Bool
var supportsOnDeviceRecognition: Bool                     // iOS 13+
var defaultTaskHint: SFSpeechRecognitionTaskHint
func recognitionTask(with: SFSpeechRecognitionRequest,
                     resultHandler: (SFSpeechRecognitionResult?, Error?) -> Void) -> SFSpeechRecognitionTask
func recognitionTask(with: SFSpeechRecognitionRequest,
                     delegate: SFSpeechRecognitionTaskDelegate) -> SFSpeechRecognitionTask
```

流式喂音频：

```swift
class SFSpeechAudioBufferRecognitionRequest                // iOS 10.0+
func append(_ buffer: AVAudioPCMBuffer)
func appendAudioSampleBuffer(_ sampleBuffer: CMSampleBuffer)
func endAudio()
var nativeAudioFormat: AVAudioFormat
```

（官方文档：https://developer.apple.com/documentation/speech/sfspeechrecognizer、https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest）

### 流式中间结果

支持。`SFSpeechRecognitionRequest.shouldReportPartialResults` **默认就是 `true`**：「A Boolean value that indicates whether you want intermediate results returned for each utterance. The default value of this property is `true`.」（官方文档：https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/shouldreportpartialresults）

结果回调里 `SFSpeechRecognitionResult.isFinal` 区分中间/最终。

### 设备端

```swift
var requiresOnDeviceRecognition: Bool    // iOS 13.0+，SFSpeechRecognitionRequest 上
```

官方讨论逐字：「Set this property to `true` to prevent an `SFSpeechRecognitionRequest` from sending audio over the network. **However, on-device requests won't be as accurate.**」以及「The request only honors this setting if the `supportsOnDeviceRecognition` property is also `true`.」（官方文档：https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition）

`supportsOnDeviceRecognition` 是 `SFSpeechRecognizer` 的实例属性，按 locale 判定，**只能运行时查**。Apple 没有公布支持设备端识别的语言清单。（官方文档：https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition）

老 API 的设备端模型和 `DictationTranscriber` 是同一套：「`DictationTranscriber` uses the same speech-to-text machine learning models as system dictation features and `SFSpeechRecognizer` when configured for on-device operation.」并且「This transcriber does not support languages or locales that `SFSpeechRecognizer` only supports via network access.」（官方文档：https://developer.apple.com/documentation/speech/dictationtranscriber）

### 中文

Apple 官方没有公布 `supportedLocales()` 的静态清单，只能运行时查。中文（普通话/粤语/繁体）自 iOS 10 起在 Siri 听写里一直可用，属社区共识，但**本次没找到可引用的官方语言列表**——标记为「官方未列出，需真机 `SFSpeechRecognizer.supportedLocales()` 实测确认」。

### 节流与配额（这条是老 API 最疼的）

官方文档逐字：

> "Speech recognition places a relatively high burden on battery life and network usage. To minimize this burden, the framework **stops speech recognition tasks that last longer than one minute**. This limit is similar to the one for keyboard-related dictation."

> "Because speech recognition is a network-based service, limits are enforced so that the service can remain freely available to all apps. **Individual devices may be limited in the number of recognitions that can be performed per day, and each app may be throttled globally based on the number of requests it makes per day.**"

> "If a recognition request fails quickly (within a second or two of starting), check to see if the recognition service became unavailable."

（官方文档：https://developer.apple.com/documentation/speech/sfspeechrecognizer）

Apple 从未给出「每天多少次」的具体数字——只有定性描述。**未查证：具体配额数值。**

一分钟上限是硬的，但有个已知 SPI 绕法：WebKit 自己就在用 `[_request _setMaximumRecognitionDuration:3600]`（见第 5 节）。私有 API，我们不能用。

### 权限

`NSSpeechRecognitionUsageDescription`，iOS 10.0+。官方描述逐字：「A message that tells people why the app is requesting to **send user data to Apple's speech recognition servers**.」「**Important:** This key is required if your app uses APIs that send user data to Apple's speech recognition servers.」（官方文档：https://developer.apple.com/documentation/bundleresources/information-property-list/nsspeechrecognitionusagedescription）

另外要 `NSMicrophoneUsageDescription`。本仓库 `src-tauri/Info.ios.plist` 现在**两个都没有**（只有 `ITSAppUsesNonExemptEncryption` 和 `CFBundleIconName`）。

---

## 3. `SpeechAnalyzer` / `SpeechTranscriber`（iOS 26 新 API）

最低系统：**iOS 26.0 / iPadOS 26.0 / macOS 26.0 / macCatalyst 26.0 / tvOS 26.0 / visionOS 26.0**，watchOS 不支持。（官方文档，全部符号页一致）

### 中文：支持

这是本次调研的关键结论，且**Apple 官方文档和 WWDC 都没有公布语言清单**——`supportedLocales` 是运行时 `async` 属性，文档只写「This array is empty if the device does not support the transcriber.」WWDC25 session 277 的讲稿原句是「SpeechTranscriber can currently transcribe **these languages**, with more to come」，语言列表只在幻灯片上，讲稿里没有。（官方文档 + WWDC：https://developer.apple.com/videos/play/wwdc2025/277/）

所以只能靠第三方运行时 dump。找到两份独立的：

**A. macOS 26.5.2（build 25F84），直接查询 `SpeechTranscriber.supportedLocales`，30 个 locale**（实测帖，2026 年，https://github.com/bitwize-ai/Logue/issues/41）：

```
de-AT de-CH de-DE en-AU en-CA en-GB en-IE en-IN en-NZ en-SG en-US en-ZA es-CL es-ES
es-MX es-US fr-BE fr-CA fr-CH fr-FR it-CH it-IT ja-JP ko-KR pt-BR pt-PT yue-CN zh-CN
zh-HK zh-TW
```

同一份报告明确列出 `.chinese → zh-CN → yes`。

**B. iOS 26 时期的第三方指南，42 个 locale**（社区，https://antongubarenko.substack.com/p/ios-26-speechanalyzer-guide）：

```
ar_SA da_DK de_AT de_CH de_DE en_AU en_CA en_GB en_IE en_IN en_NZ en_SG en_US en_ZA
es_CL es_ES es_MX es_US fi_FI fr_BE fr_CA fr_CH fr_FR he_IL it_CH it_IT ja_JP ko_KR
ms_MY nb_NO nl_BE nl_NL pt_BR ru_RU sv_SE th_TH tr_TR vi_VN yue_CN zh_CN zh_HK zh_TW
```

两份在非 CJK 语言上打架（B 比 A 多 ar/ru/nl/th/vi 等）。A 那个仓库另有一份报告明确说 `ru-RU` **不在** `SpeechTranscriber.supportedLocales` 里、但**在** `DictationTranscriber` 里（https://github.com/bitwize-ai/Logue/issues/34，2026-07-29），所以 B 那份大概率把 `DictationTranscriber` 的列表混进来了，或者取自不同 OS 版本。

**两份在中文上完全一致：`zh-CN` / `zh-HK` / `zh-TW` / `yue-CN` 都在 `SpeechTranscriber` 的支持列表里。** 这一点视为可靠（两个独立来源交叉印证）。

**注意事项**：这个列表随 OS 版本变，官方立场是运行时查。落地代码必须查 `supportedLocales`，不能硬编码。而且 locale 相等性有坑（见下）。

### 完整 API 形状

```swift
final actor SpeechAnalyzer                                          // iOS 26.0+

convenience init(modules: [any SpeechModule], options: SpeechAnalyzer.Options?)
convenience init<InputSequence>(inputSequence: InputSequence,
                                modules: [any SpeechModule],
                                options: SpeechAnalyzer.Options?,
                                analysisContext: AnalysisContext,
                                volatileRangeChangedHandler: sending ((CMTimeRange, Bool, Bool) -> Void)?) async throws
convenience init(inputAudioFile: AVAudioFile, modules: [any SpeechModule], options: SpeechAnalyzer.Options?,
                 analysisContext: AnalysisContext, finishAfterFile: Bool,
                 volatileRangeChangedHandler: sending ((CMTimeRange, Bool, Bool) -> Void)?) async throws

var modules: [any SpeechModule]
var volatileRange: CMTimeRange?
var context: AnalysisContext

func setModules(_ modules: [any SpeechModule]) async throws
func setContext(_ context: AnalysisContext) async throws
func setVolatileRangeChangedHandler(_ handler: sending ((CMTimeRange, Bool, Bool) -> Void)?)

// 流式：start 立刻返回，结果从模块的 results 序列拿
func start<InputSequence>(inputSequence: InputSequence) async throws
func start(inputAudioFile: AVAudioFile, finishAfterFile: Bool) async throws
// 阻塞式：跑到输入序列结束
func analyzeSequence<InputSequence>(_ inputSequence: InputSequence) async throws -> CMTime?
func analyzeSequence(from: AVAudioFile) async throws -> CMTime?

func finalize(through: CMTime?) async throws
func cancelAnalysis(before: CMTime)
func cancelAndFinishNow() async
func finalizeAndFinishThroughEndOfInput() async throws
func finalizeAndFinish(through: CMTime) async throws
func finish(after: CMTime) async throws

static func bestAvailableAudioFormat(compatibleWith: [any SpeechModule]) async -> AVAudioFormat?
static func bestAvailableAudioFormat(compatibleWith: [any SpeechModule],
                                     considering: AVAudioFormat?) async -> AVAudioFormat?
func prepareToAnalyze(in: AVAudioFormat?) async throws
func prepareToAnalyze(in: AVAudioFormat?, withProgressReadyHandler: sending ((NSProgress) -> Void)?) async throws
```

```swift
final class SpeechTranscriber                                       // iOS 26.0+
  : LocaleDependentSpeechModule, SpeechModule, Sendable

convenience init(locale: Locale, preset: SpeechTranscriber.Preset)
convenience init(locale: Locale,
                 transcriptionOptions: Set<SpeechTranscriber.TranscriptionOption>,
                 reportingOptions: Set<SpeechTranscriber.ReportingOption>,
                 attributeOptions: Set<SpeechTranscriber.ResultAttributeOption>)

var results: some Sendable & AsyncSequence<SpeechTranscriber.Result, any Error>

static var isAvailable: Bool
static var installedLocales: [Locale] { get async }
static var supportedLocales: [Locale] { get async }
static func supportedLocale(equivalentTo: Locale) async -> Locale?
```

`ReportingOption` 三个值（官方文档：https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption）：

- `.volatileResults` — Provides tentative results for an audio range in addition to the finalized result.
- `.fastResults` — Biases the transcriber towards responsiveness, yielding faster but also less accurate results.
- `.alternativeTranscriptions` — Includes alternative transcriptions in addition to the most likely transcription.

`Preset` 表（官方文档：https://developer.apple.com/documentation/speech/speechtranscriber/preset）：

| Preset | volatileResults | fastResults | alternativeTranscriptions | audioTimeRange |
|---|---|---|---|---|
| `transcription` | 否 | 否 | 否 | 否 |
| `transcriptionWithAlternatives` | 否 | 否 | 是 | 否 |
| `timeIndexedTranscriptionWithAlternatives` | 否 | 否 | 是 | 是 |
| `progressiveTranscription` | **是** | **是** | 否 | 否 |
| `timeIndexedProgressiveTranscription` | **是** | **是** | 否 | **是** |

我们要的是 `progressiveTranscription`（或加时间轴的那个——打断时要把助手消息截断到用户听到的位置，时间轴有用）。

`SpeechTranscriber.Result`（官方文档）：

```swift
struct Result
  var text: AttributedString          // 最可能的解释
  var alternatives: [...]             // 按可能性降序
  var range: CMTimeRange              // 来自 SpeechModuleResult
  var isFinal: Bool                   // 来自 SpeechModuleResult
  var resultsFinalizationTime: CMTime // 该时间点之前（不含）的结果已定稿
```

Overview 逐字：「If the transcriber is configured to send volatile results, each phrase is sent one or more times as the interpretation gets better and better until it is finalized.」

`text` 是 `AttributedString`，属性里带 `SpeechAttributes.TimeRangeAttribute` 和 `SpeechAttributes.ConfidenceAttribute`。

喂音频用 `AnalyzerInput`（官方文档：https://developer.apple.com/documentation/speech/analyzerinput）：

```swift
struct AnalyzerInput            // 时间编码的音频数据
init(buffer:)
init(buffer:bufferStartTime:)   // 与前一段不连续时用
var bufferStartTime / bufferDuration / bufferFormat / buffer
```

Overview 逐字：「The audio data must have an audio format that is supported by the analyzer's modules; **the analyzer does not perform audio conversion.** Call `bestAvailableAudioFormat(compatibleWith:considering:)` to select an appropriate format to convert to.」——即自己要 `AVAudioConverter`（iOS 27 起可以用新增的 `AnalyzerInputConverter`）。

### 流式最小骨架（来自 WWDC25 session 277 的官方示例代码）

```swift
func setUpTranscriber() async throws {
    transcriber = SpeechTranscriber(locale: Locale.current,
                                    transcriptionOptions: [],
                                    reportingOptions: [.volatileResults],
                                    attributeOptions: [.audioTimeRange])
    analyzer = SpeechAnalyzer(modules: [transcriber])
    self.analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
    try await ensureModel(transcriber: transcriber, locale: Locale.current)
    (inputSequence, inputBuilder) = AsyncStream<AnalyzerInput>.makeStream()
    try await analyzer?.start(inputSequence: inputSequence)
}
```

结果侧就是 `for try await result in transcriber.results { ... result.isFinal ... }`。

### 模型下载

`AssetInventory`（官方文档：https://developer.apple.com/documentation/speech/assetinventory）。Overview 逐字要点：

- 「These assets are machine-learning models downloaded from Apple's servers and managed by the system. Once you download, install, or use an asset, the system retains and updates it automatically, and **shares it with other apps**.」
- 「The system makes a certain number of locale-specific asset **reservations** available to your app to limit storage space and network usage.」→ `AssetInventory.maximumReservedLocales`、`reserve(locale:)`、`release(reservedLocale:)`、`reservedLocales`。
- 「Once assets are downloaded, they persist between app launches and are shared between apps. **The system may unsubscribe your app from assets that haven't been used in a while.**」

WWDC 官方示例：

```swift
func downloadIfNeeded(for module: SpeechTranscriber) async throws {
    if let downloader = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
        self.downloadProgress = downloader.progress
        try await downloader.downloadAndInstall()
    }
}
```

模型大小：**Apple 没公布数字，第三方也没查到具体 MB**（多次搜索均无结果）。**未查证。** 但 WWDC 明确说了它不进 app 包也不进 app 内存：「The model is retained in system storage and **does not increase the download or storage size of your application**, nor does it increase the run-time memory size. **It operates outside of your application's memory space**, so you don't have to worry about exceeding the size limit.」

### 完全设备端

是。WWDC 逐字：模型在系统存储里、在 app 内存空间外运行，隐私上「entirely on-device」。文档没有任何联网转写路径。**注意区别**：`DictationTranscriber` 文档明确说它不支持那些 `SFSpeechRecognizer` 只在联网时支持的语言——说明 Speech 框架里带联网可能性的只有老 API。

### 延迟和准确率的官方说法

只有定性的。WWDC 逐字：「The new model is **both faster and more flexible** than the one previously available through `SFSpeechRecognizer`.」「we also wanted to enable live transcription experiences that demand **low latency without sacrificing accuracy or readability**.」

**Apple 没有给任何延迟毫秒数或 WER 数字。未查证。**

### 硬件门槛（这条能一票否决具体设备）

`SpeechTranscriber.isAvailable` 会在旧设备上返回 `false`，`supportedLocales` 返回空数组。

Apple 官方论坛线程（https://developer.apple.com/forums/thread/806765，2025-11 起）里的实测：

- 不支持：iPhone 11 / 11 Pro / 11 Pro Max / iPhone SE 2、**iOS 26 模拟器**。
- 支持：iPhone 12 系列到 iPhone 17 系列；Mac mini M4、M1 机器。
- 提出的解释：8 核 Neural Engine 不行，16 核 NE 行；模拟器不模拟 ANE。

证据强度：**实测帖 + 多人复现**，不是 Apple 官方声明。回帖者身份未核实，不能当官方结论。

**模拟器不可用是工程上的实际代价**：Tauri iOS 的日常开发循环大量跑模拟器，语音这条路在模拟器里只能降级到 `SFSpeechRecognizer` 或 mock。

### Locale 相等性的坑（官方论坛，Apple_Agent 回复）

https://developer.apple.com/forums/thread/790108：

> "The locales in `SpeechTranscriber.supportedLocales` will work, but **arbitrary locales such as `Locale.current` or `Locale(identifier: "en_US")` may not**, because the exact equality of locales differ depending on how they were created. Use `SpeechTranscriber.supportedLocale(equivalentTo:)` to get a locale in the supported list roughly equivalent to a locale obtained from elsewhere."

同帖社区补充（Logue #34，2026-07-29 实测）：`supportedLocale(equivalentTo:)` 对 `ru_RU` 会返回 `ru_RU`，**即使 `ru-RU` 根本不在 `supportedLocales` 里**——所以判定必须用 `supportedLocales` 的成员检查，不能信 `supportedLocale(equivalentTo:)` 的返回值。

还有一个 macOS 上真实踩过的坑：系统语言 en-US + 地区德国时 `Locale.current.identifier` 是 `en_US@rg=dezzzz`，直接拿去构造会报 unsupported（https://github.com/finnvoor/yap/issues/1）。

### 附带能力：VAD 和自定义词表

**`SpeechDetector`**（官方文档：https://developer.apple.com/documentation/speech/speechdetector）：设备端 VAD 模块，和 transcriber 一起挂进 analyzer：

```swift
let transcriber = SpeechTranscriber(..)
let speechDetector = SpeechDetector()
let analyzer = SpeechAnalyzer(.., modules: [speechDetector, transcriber])
```

有 `SensitivityLevel`（推荐 `.medium`）。「This module only functions in conjunction with a `SpeechTranscriber` or `DictationTranscriber` module.」它是省电门控，不是轮次检测器——docs/27 里定的 smart-turn 那条路不能被它替代，但可以省掉一层自建 VAD。

**`AnalysisContext`**（官方文档：https://developer.apple.com/documentation/speech/analysiscontext）：

```swift
final class AnalysisContext
init()
var contextualStrings: ...     // Words or phrases, grouped by tag, that should be
                               // recognized even if they are not in the system vocabulary.
var userData: ...
```

配 `SpeechAnalyzer.setContext(_:)` 可以在会话中途换。**这正是 docs/27 里想要的 hotword boosting**：把当前书名、章节标题、划中的段落作为 `contextualStrings` 喂进去，让专名在 ASR 阶段就纠正，而不是让润色模型事后猜。云端 SenseVoice 端点做不到这件事。

框架还有 `SFSpeechLanguageModel` / `SFCustomLanguageModelData`（"Custom vocabulary" 分组）走更重的自定义语言模型路线，本次没细查。

---

## 4. 两者取舍

**推荐 `SpeechAnalyzer` + `SpeechTranscriber`，最低系统抬到 iOS 26。**

理由按重要性排：

1. **老 API 的一分钟硬上限直接毙掉这个场景。** 目标是「AI 念简报、用户随口打断插话」，识别会话要长时间挂着。`SFSpeechRecognizer` 每分钟就要重启一次 task，重启期间丢音频，接缝处必然吃字。绕过它的 `_setMaximumRecognitionDuration:` 是私有 API（WebKit 自己在用，我们不能用）。

2. **老 API 是网络服务，还有不公开的每日配额。** 官方原文就写着「Individual devices may be limited in the number of recognitions that can be performed per day, and each app may be throttled globally」。一个每天念简报、随时插话的产品，正好是会撞上这个的用法。设备端（`requiresOnDeviceRecognition = true`）能躲开配额，但官方同时写明「on-device requests won't be as accurate」，且能不能开由运行时的 `supportsOnDeviceRecognition` 决定。

3. **新 API 完全设备端，零延迟零费用零网络**，正是这次换件的三个目标。

4. **`AnalysisContext.contextualStrings` 给了云端拿不到的东西**：把书名、章节、划中段落喂进 ASR 做专名纠正。这是本项目相对通用听写工具的结构性优势（docs/27 已经写了这个方向，但当时不知道有没有端点支持——现在知道有）。

5. **中文确认支持**，`zh-CN`/`zh-HK`/`zh-TW`/`yue-CN` 都在。

### 抬到 iOS 26 的代价，值不值

值。具体代价：

- 仓库现在 `src-tauri/tauri.conf.json` 写的是 `"minimumSystemVersion": "16.0"`。抬到 26 会砍掉 iOS 16–25 的设备。
- 但硬件门槛已经比系统版本更严：**iPhone 12 以下（8 核 NE）即使升到 iOS 26 也用不了 `SpeechTranscriber`**。所以真正的下限是 iPhone 12 / A14。
- iOS 26 是 2025-09 发布的，到现在（2026-08）快一年，iOS 27 下个月发。这是个成熟版本，不是刚出来的。
- 本项目是单用户自用工具（项目发起人自己 + TestFlight），不是要覆盖长尾装机量的商业 app。这个代价基本为零。

**做法建议**：不要全局抬 `minimumSystemVersion`，而是让语音这一个功能按运行时能力开关。iOS 26 以下 / `isAvailable == false` / 模拟器 → 隐藏实时语音入口，保留现有的按住说话（走云端 SenseVoice）。这和 docs/15 里已有的 `hasNativeRecorder` 按宿主能力决定显不显示是同一个套路。全局抬版本反而把不需要语音的功能也一起砍了。

### 如果新 API 不支持中文（假设不成立，但记一下）

老 API 的中文流式**质量本身够用**——它就是 iOS 键盘听写的同一套引擎，中文听写在 iPhone 上一直可用。真正的问题不是质量而是那两条限制：一分钟上限和每日配额。所以即使中文不支持，也不会转回老 API，而会转回 sherpa-onnx 中文流式 Zipformer（docs/27 已调研）。

---

## 5. WKWebView 里的 Web Speech API

这条查到了确凿的源码级证据。

### 底层就是 `SFSpeechRecognizer`

WebKit 在 Apple 平台上的 Web Speech recognition 实现 `Source/WebCore/Modules/speech/cocoa/WebSpeechRecognizerTask.mm` 直接持有 `RetainPtr<SFSpeechRecognizer>`。构造逻辑逐字（官方源码，2026-08-09 抓 `main` 分支）：

```objc
static constexpr size_t maximumRecognitionDuration = 60 * 60;
...
if (![localeIdentifier length])
    _recognizer = adoptNS([PAL::allocSFSpeechRecognizerInstance() init]);
else
    _recognizer = adoptNS([PAL::allocSFSpeechRecognizerInstance() initWithLocale:[NSLocale localeWithLocaleIdentifier:localeIdentifier]]);
if (!_recognizer) { [self release]; return nil; }
if (![_recognizer isAvailable]) { [self release]; return nil; }
[_recognizer setDelegate:self];

_request = adoptNS([PAL::allocSFSpeechAudioBufferRecognitionRequestInstance() init]);
if ([_recognizer supportsOnDeviceRecognition])
    [_request setRequiresOnDeviceRecognition:YES];
[_request setShouldReportPartialResults:interimResults];
[_request setTaskHint:SFSpeechRecognitionTaskHintDictation];
[_request setDetectMultipleUtterances:YES];
[_request _setMaximumRecognitionDuration:maximumRecognitionDuration];

_task = [_recognizer recognitionTaskWithRequest:_request.get() delegate:self];
```

（https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/cocoa/WebSpeechRecognizerTask.mm）

推论，全部有源码支撑：

- **走不走网络**：只要设备支持设备端识别，WebKit 就强制 `requiresOnDeviceRecognition = YES`，不走网。不支持时退回联网。**由 locale 和设备决定，网页控制不了。**
- **中文支持**：等同于 `SFSpeechRecognizer` 的语言支持，网页传 `lang` 属性下去构造 `NSLocale`。
- **不受一分钟限制**：WebKit 用 SPI 把上限设成 3600 秒。这是 Web Speech API 相对我们直接调 `SFSpeechRecognizer` 的唯一优势。
- **不是新 API**：它用的是老引擎，不是 `SpeechAnalyzer`。所以 Web 路线拿不到 `AnalysisContext` 的自定义词表，也拿不到新模型的质量。

### WKWebView 里能不能用：能，但要宿主 app 配合

WebKit bug 239816「[iOS] Web Speech API doesn't work in WKWebView, but works in Safari」（2022-04-27 报，2022-08-02 关，**RESOLVED / WORKSFORME**）。报告人 Ali Juma 原话：「webkitSpeechRecognition is exposed on window, but doesn't work (the permission prompt never appears)」，结论是缺 `NSSpeechRecognitionUsageDescription`，报错是 `service-not-allowed`。（https://bugs.webkit.org/show_bug.cgi?id=239816）

源码印证。`Source/WebKit/UIProcess/Cocoa/MediaPermissionUtilities.mm`：

```cpp
bool checkUsageDescriptionStringForSpeechRecognition()
{
    return dynamic_objc_cast<NSString>(NSBundle.mainBundle.infoDictionary[@"NSSpeechRecognitionUsageDescription"]).length > 0;
}
```

`Source/WebKit/UIProcess/SpeechRecognitionPermissionManager.cpp` 的门禁顺序（四道，任一失败就报错）：

1. 麦克风 TCC + `NSMicrophoneUsageDescription` → 失败报 `NotAllowed`，message `"Microphone permission check has failed"`
2. 语音识别 TCC（`SFSpeechRecognizer requestAuthorization`）+ `NSSpeechRecognitionUsageDescription` → 失败报 `ServiceNotAllowed`，message `"Speech recognition service permission check has failed"`
3. `checkSpeechRecognitionServiceAvailability(locale)`（构造 recognizer 并查 `isAvailable`）→ 失败报 `ServiceNotAllowed`，message `"Speech recognition service is not available"`
4. 站点授权 → 失败报 `NotAllowed`，message `"User permission check has failed"`

第 4 步走 `requestUserMediaPermissionForSpeechRecognition`，宿主没实现对应 delegate 时落到 `decideByDefaultAction` → `alertForPermission(..., MediaPermissionReason::SpeechRecognition, ...)`，即弹系统 alert。所以**不实现 delegate 也能用，只是会弹一次系统询问**。

（源码：https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/SpeechRecognitionPermissionManager.cpp、.../Cocoa/MediaPermissionUtilities.mm）

**Tauri 落地清单**：`src-tauri/Info.ios.plist` 里加 `NSMicrophoneUsageDescription` 和 `NSSpeechRecognitionUsageDescription`。现在两个都没有——所以**如果现在直接在 iOS 上试 `webkitSpeechRecognition`，一定报 `service-not-allowed`，且这不是「iOS 不支持」，是配置缺失**。

### 仍然存疑的

- 有 Stack Overflow 报告说「模拟器上弹权限、真机不弹」（https://stackoverflow.com/questions/71402230/webkitspeechrecognition-not-working-in-wkwebview，2022）。本次 WebFetch 抓不到 stackoverflow（被拒），**答案内容未查证**。
- Tauri 官方仓库里搜不到任何 speech recognition 相关 issue（`gh search issues --repo tauri-apps/tauri`，0 结果）。**没有人报告过在 Tauri 里用 Web Speech API，成败都没有先例。**
- WebKit 的 `_setMaximumRecognitionDuration:` 是否让 Web 路线也绕过每日配额限制——**未查证**。配额是服务端的事，设备端识别时应该不涉及，但没有官方说明。

---

## 6. Tauri 桥接

### 官方 iOS 插件写法

（官方文档：https://v2.tauri.app/develop/plugins/develop-mobile/，2026-08-09 查）

Swift 侧继承 `Plugin`，命令是带 `@objc` 和 `(_ invoke: Invoke)` 的方法：

```swift
class ExamplePlugin: Plugin {
  @objc public override func load(webview: WKWebView) {
    let timeout = self.config["timeout"] as? Int ?? 30
  }

  @objc public func openCamera(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenArgs.self)
    invoke.resolve(["path": "/path/to/photo.jpg"])
  }
}

class OpenArgs: Decodable {
  let requiredArg: String     // let = 必填
  var allowEdit: Bool?        // var + Optional = 选填
}
```

**流式事件往 webview 推**（这条正是我们要的）：Swift 侧 `trigger`，JS 侧 `addPluginListener`：

```swift
class ExamplePlugin: Plugin {
  @objc public func startTranscribe(_ invoke: Invoke) {
    trigger("partial", data: ["text": "...", "isFinal": false])
  }
}
```

```javascript
import { addPluginListener } from '@tauri-apps/api/core'
await addPluginListener('speech', 'partial', (payload) => { ... })
```

权限：重写 `checkPermissions(_:)` / `requestPermissions(_:)`，Tauri 自动把这两个命令暴露给 JS 和 Rust。

Swift 调 Rust 走 C FFI（`@_silgen_name` + `#[no_mangle] extern "C"`）——我们大概率不需要，识别结果直接从 Swift `trigger` 到 JS 就行。

插件是 Swift Package，用 SPM 管依赖。

### 现成的第三方插件

**没有。** `gh search repos "tauri speech recognition plugin"` 和 `"tauri plugin stt ios"` 都是 0 结果（2026-08-09）。要自己写。

参考实现可以看非 Tauri 的封装：`blendfactory/speech-kit`（Apple Speech 框架的 Dart 绑定）、`Saber5656/handsfree` 的 issue #8 里有一份相当完整的 `AppleSTTProvider` 设计（可用性决策表、asset 安装流程、错误分类、`AVAudioConverter` 格式转换、`stopStream` 时 finalize 保证尾部音频出最终结果），可以直接抄结构。

### 架构上的一个岔路

现在的录音是 Rust cpal（`src-tauri/src/voice.rs`，`#[cfg(desktop)]`）。iOS 这条路不能沿用：

- 走原生插件：Swift 侧用 AVAudioEngine 采集（iOS 27 起可以直接用 `CaptureInputSequenceProvider`），喂 `SpeechAnalyzer`，`trigger` 把 volatile/final 结果推给 JS。回声消除靠 `AVAudioSession` 的 `.voiceChat` 模式。
- 走 webview `getUserMedia` 采集 + 原生识别：要把 PCM 从 JS 传到 Swift，IPC 开销大，且 docs/15 已经记过「WAV 字节经 IPC 以数字数组回传，长录音偏重」的坑。**不推荐。**

采集和识别都放 Swift 侧、只把文本推回 webview，是唯一合理的切法。docs/27 说「回声消除只有 webview 给」那条结论要修正——`AVAudioSession` 的 voice-processing I/O 在原生侧一样有，只是 cpal 拿不到。

---

## 7. 对比基线：Apple vs SenseVoiceSmall（中文）

**没有可查的第三方对比评测。未查证。**

搜索结果：

- Apple 从未公布 `SpeechTranscriber` 的任何 WER 数字，中文的更没有。
- 找到的几篇中文「实测」文章（juejin 7661901382698729507 等）没有具体百分比，只有「差距不大」「更稳定」这类模糊表述，也没给测试方法和数据链接。判定为**推测性文章，不可引用**。
- SenseVoiceSmall 侧只找到官方仓库的定性说法「In terms of Chinese and Cantonese recognition, the SenseVoice-Small model has advantages」，检索中没拿到 AISHELL-1 的具体 WER 数字。
- **Apple SpeechAnalyzer 与 SenseVoiceSmall 的直接对比：不存在。**

中英混说（code-switching）：**没有任何关于 `SpeechTranscriber` 的说法**，Apple 没提，第三方没测。docs/27 里记的「全行业未解决」这条结论继续有效。可以推测的是 `SpeechTranscriber` 每个实例绑一个 locale，模型是 per-locale 下载的，所以更可能是「按一个语言解码」而非逐词切换——但这是推测，**未查证**。

结论：**只能自己测。** 这是选型前唯一需要真机做的实验，而且它同时是最便宜的实验——一个最小 Swift 命令行/demo，喂几段中文和中英混说，对比现有 SenseVoice 的输出即可。注意必须真机（模拟器上 `isAvailable == false`）。

---

## 落地风险清单

1. 模拟器不可用，日常开发循环必须真机或降级 mock。
2. locale 相等性要用 `supportedLocales` 成员检查，不能信 `Locale.current`，也不能信 `supportedLocale(equivalentTo:)` 的返回值。
3. `AssetInventory` 的 reservation 有上限（`maximumReservedLocales`，具体数值未查证），且系统会在长期不用后取消订阅——不能假设模型永远在。
4. 首次使用要下载模型，大小未知，需要一个下载进度 UI（`AssetInstallationRequest.progress`）。
5. iPhone 12 以下即使升 iOS 26 也不可用。
6. `src-tauri/Info.ios.plist` 现在缺 `NSMicrophoneUsageDescription` 和 `NSSpeechRecognitionUsageDescription`。原生插件路线只需要前者（新 API 不联网，但 TCC 语音识别授权是否仍需要——见下）。
7. **未查证：`SpeechAnalyzer`/`SpeechTranscriber` 是否需要 `SFSpeechRecognizer.requestAuthorization` 那套语音识别 TCC 授权，还是只要麦克风权限。** Apple 文档没写清楚。`Saber5656/handsfree` 的 issue #8 把这个列为「known unknown #2」并计划实测钉死，说明社区也不确定。这条要真机实测。

---

# 追加：进程模型、音频来源、后台行为（2026-08-09 第二轮）

## Q1 推理跑在哪个进程

**跑在系统 XPC 服务里，不在 app 进程里。** app 进程只剩音频搬运。

证据链：

1. **官方（WWDC25 session 277）**，讲 `SpeechTranscriber` 模型：「The model is retained in system storage and does not increase the download or storage size of your application, **nor does it increase the run-time memory size. It operates outside of your application's memory space**, so you don't have to worry about exceeding the size limit.」

2. **iOS 26 / 27 固件里确实有这些独立进程**（来自 IPSW dyld_shared_cache 提取的公开 diff 仓库 blacktop/ipsw-diffs，2026-08-09 查）：

   - `com.apple.SpeechRecognitionCore.speechrecognitiond`，路径 `/System/Library/PrivateFrameworks/SpeechRecognitionCore.framework/XPCServices/com.apple.SpeechRecognitionCore.brokerd.xpc/XPCServices/com.apple.SpeechRecognitionCore.speechrecognitiond.xpc/…`（iOS 18.x 到 26.x 到 27.0 beta 一直在）
   - `localspeechrecognition`（XPC service name `com.apple.speech.localspeechrecognition`）
   - `corespeechd`（有 `/var/mobile/tmp/com.apple.corespeechd/AudioCapture/siri` 这样的 iOS 路径）、`speechmaintenanced`、`CoreEmbeddedSpeechRecognition` dylib

3. **`localspeechrecognition` 的沙箱 profile 里有 `(allow iokit-open-user-client (iokit-registry-entry-class "AGXAccelerator"))`** —— 加速器（GPU/ANE 那条 IOKit 通道）是在**那个服务的进程里**打开的，不是 app 里。

4. WebKit 的沙箱 profile 把 `(global-name "com.apple.speech.recognitionserver")` 当作一个 mach service 处理（WebProcess 里是 deny，说明识别不在渲染进程做）。

证据强度：第 1 条官方，第 2/3/4 条是固件与源码级事实，**「推理在独立进程」这个结论可靠**。

**占不占 app 的后台 CPU 预算：未查证，但判断不构成阻塞。** 理由：

- iOS 的后台 CPU 上限是 `EXC_RESOURCE / RESOURCE_TYPE_CPU`，**按进程**记账。XPC 服务由 launchd 拉起，是独立进程，有自己的沙箱和 jetsam band。
- Apple DTS 在最新那条 iOS 26.5 后台录音线程（下面 Q3）里给出的排查清单里**根本没有 CPU 这一项**，只有 audio session 活跃性、中断处理、和内存（指导值 <100MB）。
- 但 Apple 从未文档化 XPC 记账规则，所以这条要在真机上用 Instruments 钉死。

**顺带纠正一个数字**：那个后台 CPU 预算的准确表述是 **60% CPU 平均值 over 15 秒窗口**，不是「15 秒内 9 秒」。崩溃日志原文（react-native-webrtc issue #998）：「9 seconds cpu time over 9 seconds (100% cpu average), **exceeding limit of 60% cpu over 15 seconds**」——9 秒是那个案例实际烧掉的量。而且这个案例**就是带 audio background mode 的**，说明该上限对后台音频 app 同样生效。方向对，数字要改。

## Q2 原生 ASR 的音频来源

**必然要求宿主 app 自己激活 AVAudioSession。形态锁死为「全原生」。**

官方文档 `AVAudioEngine.inputNode` 逐字：

> "When the engine renders to and from an audio device, **the `AVAudioSession` category and the availability of hardware determines whether an app performs input**. Check the input node's input format (specifically, the hardware format) for a nonzero sample rate and channel count to see if input is in an enabled state. **Trying to perform input through the input node when it isn't available or in an enabled state causes the engine to throw an error (when possible) or an exception.**"

即宿主必须把自己的 session 设成 `.record` 或 `.playAndRecord` 并 `setActive(true)`，直接撞上约束 1（宿主改 session 会打断 webview 播放）。

**让原生识别器消费 webview 的 getUserMedia 流：做不到，判断正确。** `MediaStream` 只存在于 WebKit 自己的进程里（`RealtimeMediaSource` / `SpeechRecognitionRemoteRealtimeMediaSourceManager`），没有任何公开接口把它导出给宿主 app。反方向（把宿主采的音频喂进 webview）也没有。

唯一的中间态是把 PCM 从 JS IPC 传到 Rust/Swift——docs/15 已经记过这条的重量问题（WAV 字节以数字数组回传），流式场景下更不可行。

## Q3 后台 / 锁屏

分两层，音频采集层有官方答案，识别层没有。

### 音频采集层：官方支持，条件明确

`AVAudioSession.Category.record` 和 `.playAndRecord` 的官方 Discussion 都写着：

> "To continue recording audio when your app transitions to the background (for example, when the screen locks), add the `audio` value to the `UIBackgroundModes` key in your information property list file."

Apple DTS 工程师 Kevin Elliott 在 2026 年那条「iOS 26.5 SIGKILLs audio-recording app at ~50s of background」线程（https://developer.apple.com/forums/thread/826462）里给出的正式回答：

- 支持的路径只有两条要求：**① 有 `audio` background category；② 只在前台激活 audio session**（很多高层 API 会自己反复激活/停用 session，不能用）。
- 「indefinite background microphone-only recording」**是支持的**，只要 session 保持激活。
- **iOS 26 不区分「只录音」和「录音+放音」**。不需要为了保活去播静音。
- `BGContinuedProcessingTask` 也能延时间，但有 audio background category 就够了。
- 那个 ~50s 的死亡不是音频系统干的，要去看 `runningboardd` 日志找真凶。

另外三条硬约束（DTS 线程 + 社区实测汇总）：

- **后台不能启动或重启麦克风采集**：`AVAudioSession.ErrorCode.cannotStartRecording`（561145187，`!rec`），iOS 12.4 起封的。麦克风只能在前台起。
- **任何 AVAudioSession 中断（来电、Siri）= 会话死亡**，后台重启会抛 `!rec`，不能自动恢复。
- **`UIBackgroundModes=audio` 只在音频 I/O 真的在跑时保活**。DTS 原话：「The 'audio' background category allows your app to **remain awake while your audio session is active**, which isn't quite the same as guaranteeing it will not be suspended.」静默 session 会被系统中断且不恢复。→ 没有「挂着待命但不录」的后台状态。
- 内存：DTS 指导后台常驻 **<100MB**。`SpeechTranscriber` 的模型在 app 内存空间之外，这一条正好有利。

### 识别层：官方零说法

**Apple 没有任何关于 `SFSpeechRecognizer` 或 `SpeechAnalyzer` 在后台/锁屏行为的文档、WWDC 陈述或论坛回复。未查证。**

能拿到的旁证，方向相反：

- 反面：有人用 `BGTaskScheduler` 在后台批量转写播客，被 iOS 直接终止，日志「Background transcription task expired (iOS terminated it)」，结论「For long podcasts, you need to keep the app in foreground」（2025-12-17，https://jakespurlock.com/2025/12/...）。但这是 `BGProcessingTask` 场景，**不是 audio background mode + 活跃 session** 的场景，不能直接套用。
- 正面：superwhisper 的产品说明「Switchback no longer needed for Parakeet models」——本地 ASR + 后台录音让他们去掉了每次听写的 app 跳转。说明「后台持续录 + 本地推理」在 iOS 上是能做出来的产品形态。
- 正面：Wispr Flow 的 iOS 文档写「Recording auto-stops a few minutes after the app is sent to the background」——他们主动设了超时，不是被系统杀。
- 老 API 额外的坑：iOS 17 起 `requiresOnDeviceRecognition = true` 需要用户在设置里开着 Siri 或键盘听写，否则报「Siri and Dictation are disabled」（https://developer.apple.com/forums/thread/739006，FB13235751，无 Apple 回复）。新 API 的 `DictationTranscriber` 明确解决了这个（WWDC25：「you will NOT need to tell your users to go into Settings and turn on Siri or keyboard dictation」），`SpeechTranscriber` 推测同理但未见明文。

**结论**：后台录音这一半有官方背书，后台识别这一半只能实测。而且实测很便宜——一个最小 demo，前台起会话，切后台锁屏，看 volatile/final 还出不出。

## Q5（提优先级）WKWebView 里的 `webkitSpeechRecognition`

**能用。默认就是开的。挡住它的是宿主 Info.plist，不是平台。**

### 决定性证据：WebKit 的 preference 默认值

`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`（main 分支，2026-08-09 抓）：

```yaml
SpeechRecognitionEnabled:
  type: bool
  status: mature
  humanReadableName: "SpeechRecognition API"
  humanReadableDescription: "Enable SpeechRecognition of WebSpeech API"
  defaultValue:
    WebKitLegacy:
      default: false
    WebKit:
      "HAVE(SPEECHRECOGNIZER) && ENABLE(MEDIA_STREAM)": true
      default: false
    WebCore:
      default: false
  disableInLockdownMode: true
  sharedPreferenceForWebProcess: true
```

`WebKit` 就是现代 WKWebView 那套框架。在 iOS/macOS（`HAVE(SPEECHRECOGNIZER)` 成立）上**默认 true**，`status: mature`，**不是 Safari 专属、不需要私有开关**。embedder 想改可以用 `WKPreferencesPrivate._speechRecognitionEnabled`（macOS 12 / iOS 15+，SPI）。**Lockdown Mode 下会被关掉。**

2022 年那个「WKWebView 里不工作」的 bug（239816）以 WORKSFORME 结案，原因就是缺 plist key —— 和这份默认值一致。

### 四道门禁（`SpeechRecognitionPermissionManager.cpp`，官方源码）

按顺序，任一失败就抛对应的 `SpeechRecognitionError`：

| # | 检查 | 失败时的 error / message |
|---|---|---|
| 1 | 麦克风 TCC + `NSMicrophoneUsageDescription` 非空 | `not-allowed` / `"Microphone permission check has failed"` |
| 2 | 语音识别 TCC（`SFSpeechRecognizer.requestAuthorization`）+ `NSSpeechRecognitionUsageDescription` 非空 | `service-not-allowed` / `"Speech recognition service permission check has failed"` |
| 3 | `checkSpeechRecognitionServiceAvailability(locale)`（构造 recognizer 查 `isAvailable`） | `service-not-allowed` / `"Speech recognition service is not available"` |
| 4 | 站点授权 | `not-allowed` / `"User permission check has failed"` |

第 4 步走 `WebPageProxy::requestUserMediaPermissionForSpeechRecognition`；宿主没实现对应 delegate 时落到 `decideByDefaultAction` → `alertForPermission(...)`，弹系统 alert。**所以不需要写任何 delegate，只是会多一次系统询问。**

`NSSpeechRecognitionUsageDescription` 那次授权弹的是系统文案「Speech data from this app will be sent to Apple to process your requests.」（Apple 论坛 801759）——即使实际走设备端也这么写，这是老 API 的固定文案。

### 音频从哪来：WebKit 自己采，不碰宿主的 AVAudioSession

网页**不需要自己调 `getUserMedia`**。WebKit 内部通过 `SpeechRecognitionRemoteRealtimeMediaSourceManager` / `RealtimeMediaSource` 采集，音频在 WebKit 进程侧。这正好落在「全在 webview」形态里，不触发约束 1。

### 走不走网络：设备支持时强制不走

`WebSpeechRecognizerTask.mm` 逐字：

```objc
_request = adoptNS([PAL::allocSFSpeechAudioBufferRecognitionRequestInstance() init]);
if ([_recognizer supportsOnDeviceRecognition])
    [_request setRequiresOnDeviceRecognition:YES];
[_request setShouldReportPartialResults:interimResults];
[_request setTaskHint:SFSpeechRecognitionTaskHintDictation];
[_request setDetectMultipleUtterances:YES];
[_request _setMaximumRecognitionDuration:maximumRecognitionDuration];   // 60 * 60 秒
```

- 设备支持设备端识别时 → 强制 `requiresOnDeviceRecognition = YES`，**不走网**。不支持时退回联网。网页控制不了。
- JS 的 `recognition.interimResults` → `shouldReportPartialResults`，**流式中间结果直通**。
- JS 的 `recognition.continuous` → `detectMultipleUtterances`。
- JS 的 `recognition.lang` → 直接构造 `NSLocale`，**中文支持 = `SFSpeechRecognizer` 的中文支持**。
- **一小时上限**（WebKit 用 SPI 设的），不是老 API 那个一分钟。

`callbackWithTranscriptions:isFinal:` 把 `SFTranscription.formattedString` 和 segment 置信度包成 `SpeechRecognitionResultData`，`isFinal` 直通到 JS。

### 这条路的真实缺陷

1. **用的是老引擎**，不是 `SpeechAnalyzer`。中文质量 = iOS 键盘听写的设备端模型水平，不是 iOS 26 新模型。
2. **拿不到 `AnalysisContext.contextualStrings`**，专名/术语只能靠事后润色猜。这是本项目最想要的那个能力。
3. **继承 iOS 17+ 的坑**：设备端识别要求用户设置里开着 Siri 或键盘听写，否则「Siri and Dictation are disabled」。
4. **Lockdown Mode 直接关掉。**
5. **后台行为未查证**：webview 的 `getUserMedia` 在 audio background mode 下能继续（团队已查证），但 Web Speech 的识别会话在后台是否继续，没有任何证据。
6. **Tauri 生态零先例**：`tauri-apps/tauri` 仓库里搜不到任何 speech recognition 相关 issue；Capacitor/Cordova 生态一律用原生插件（`@capacitor-community/speech-recognition`，README 要求的正是那两个 plist key），没人依赖 webview 里的 Web Speech API。

### 修正的形态建议

先做 Web Speech 的真机 spike，因为它成本最低（零原生代码，只加两个 plist key），且能一次性验证形态是否成立：

1. `src-tauri/Info.ios.plist` 加 `NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription`。
2. 真机（非模拟器）跑一段 `webkitSpeechRecognition`，`lang = 'zh-CN'`、`interimResults = true`、`continuous = true`。
3. 三件事一次看完：中文流式质量够不够、切后台锁屏还出不出结果、中英混说崩成什么样。

结果分岔：

- **够用** → 全在 webview，零原生代码，TTS 也留在 web 侧，形态最简单。
- **不够用**（多半是术语/专名，因为拿不到热词表）→ 上 Tauri 原生插件走 `SpeechAnalyzer`，此时形态锁死为**全原生**：采集、识别、TTS 播放全搬到 Swift，webview 只剩 UI 和文本流。这是个大得多的工程，但也是唯一能拿到 `contextualStrings` 的路。

不要试图混合。约束 1 已经排除了中间态。

---

# 追加二：并行采集、后台存活、设备端配额（2026-08-09 第三轮）

全部证据来自 WebKit `main` 分支源码（2026-08-09 抓）和 Apple 官方 WWDC，除非另注。

## Q6 Web Speech 与页面自己的 getUserMedia 能否共存

**能。走的是同一套采集设施，共享同一个 capture unit，用引用计数并存。**

### 走同一条路的证据

`SpeechRecognitionCaptureSource::createRealtimeMediaSource`（`Source/WebCore/Modules/speech/SpeechRecognitionCaptureSource.cpp`）：

```cpp
CaptureSourceOrError SpeechRecognitionCaptureSource::createRealtimeMediaSource(const CaptureDevice& captureDevice, PageIdentifier pageIdentifier)
{
    return RealtimeMediaSourceCenter::singleton().audioCaptureFactory().createAudioCaptureSource(
        captureDevice, { "SpeechID"_s, "SpeechID"_s }, { }, pageIdentifier);
}
```

和 `getUserMedia` 用的是**同一个 `RealtimeMediaSourceCenter::singleton().audioCaptureFactory()`**，产出的也是同一个类 `CoreAudioCaptureSource`。注意第三个参数是 `{ }`——**Web Speech 不传任何 MediaConstraints**。

设备选择：`findCaptureDevice()` 遍历 `captureDevices()`，跳过 speaker，优先取 `isDefault()` 的那个。

### 共存机制：一个 unit，多个 client，引用计数

`BaseAudioCaptureUnit`（`Source/WebCore/platform/mediastream/cocoa/BaseAudioCaptureUnit.h/.cpp`）：

```cpp
ThreadSafeWeakHashSet<CoreAudioCaptureSource> m_clients;
void addClient(CoreAudioCaptureSource&);
void removeClient(CoreAudioCaptureSource&);
bool hasClients() const { return !m_clients.isEmptyIgnoringNullReferences(); }
```

`startProducingData()` 里 `if (++m_producingCount != 1) return;`——**只有第一个 client 真正启动音频单元，后面的只加计数**。`stopProducingData` 反过来，减到零才 `stopRunning()`。麦克风采样在 unit 里采一次，通过 `m_audioThreadClients` 扇出给所有 client。

所以：不会创建第二个 `CoreAudioCaptureUnit`，也不会失败。**答案是共享单例。**

### AEC 会不会因为两个消费者而异常

不会异常，但**有互相干扰的真实路径**，而且 iOS 比 macOS 更糟。

`CoreAudioCaptureSource::initializeToStartProducingData()`（`CoreAudioCaptureSource.cpp`）：

```cpp
#if PLATFORM(MAC)
    if (echoCancellation() != m_unit->enableEchoCancellation())
        m_unit = echoCancellation() ? Ref { CoreAudioCaptureUnit::defaultSingleton() } : CoreAudioCaptureUnit::createNonVPIOUnit();
#endif
    Ref unit = m_unit;
    unit->addClient(*this);
    unit->setCaptureDevice(...);
    bool shouldReconfigure = echoCancellation() != unit->enableEchoCancellation() || sampleRate() != unit->sampleRate() || volume() != unit->volume();
#if !PLATFORM(MAC)
    unit->setEnableEchoCancellation(echoCancellation());
#endif
    unit->setSampleRate(sampleRate());
    unit->setVolume(volume());
    if (shouldReconfigure)
        unit->reconfigure();
```

关键：**「AEC 关掉时换一个非 VPIO 的独立 unit」这条路径是 `#if PLATFORM(MAC)` 专属。iOS 上只有 `defaultSingleton()` 一个 unit**，AEC 是**进程级**的一个布尔，谁后启动谁把它设成自己的值并 `reconfigure()`。

反向同步也存在：

```cpp
void CoreAudioCaptureSource::echoCancellationChanged()
{
    if (!isProducingData() || echoCancellation() == m_unit->enableEchoCancellation())
        return;
    m_echoCancellationChanging = true;
    setEchoCancellation(m_unit->enableEchoCancellation());   // 反过来把自己改成 unit 的值
    ...
}
```

对我们的实际含义：

- Web Speech 的 source 在构造时 `initializeEchoCancellation(unit->enableEchoCancellation())`——**它继承 unit 当前的值，自己不表态**。所以它不会主动把 AEC 关掉。
- 页面自己的 KWS 流如果 `getUserMedia({echoCancellation:true})`，两边一致，VPIO 保持开着，**两个消费者拿到的是同一份已经过 AEC 的音频**（AEC 在 VPIO 里做，在扇出之前）。这是想要的结果。
- 页面如果 `echoCancellation:false`（比如为了给 KWS 喂原始音频），iOS 上会把**整个进程**的 AEC 关掉，Web Speech 也跟着失去 AEC。**不要这么做。**
- 每次构造新 source 都会调 `unit->prepareForNewCapture()`，它 `m_volume = 1; resetSampleRate();`——会对正在跑的那条流造成一次轻微重配置。
- 两条流如果选了不同的采集设备，`setCaptureDevice` 触发 `willChangeCaptureDeviceTo`，unit 只有一个设备，会打架。Web Speech 固定选默认设备，所以 KWS 那条也应显式选默认设备。

### 结论

半双工形态在 webview 路线下**可行**：页面自己 `getUserMedia({echoCancellation:true})` 喂 sherpa-onnx KWS（WASM），同时按需起 `webkitSpeechRecognition`，两者共享同一个 VPIO unit。约束是 KWS 那条流**必须**也请求 `echoCancellation:true`，否则会把 AEC 从整个进程里拆掉。

未查证：`{ }` 空 constraints 下 Web Speech source 的初始 AEC 值——代码上是继承 unit 当时的值，unit 的初值是 `m_enableEchoCancellation { true }`，所以**首次启动时应为 true**，但没有实测确认 iOS 上 `m_canEnableEchoCancellation` 一定为真。

## Q7 Web Speech 识别会话在后台/锁屏

**结构上和 getUserMedia 完全同一套生命周期，「宿主声明 audio 后台模式则 webview 采集在后台继续」这条能顺延过来。** 但仍有一处需要实测。

### 三条源码事实

**① 活跃的 Web Speech 会话会把页面标成「正在采集麦克风」，和 getUserMedia 一模一样。**

`Document::updateIsPlayingMedia()`（`Source/WebCore/dom/Document.cpp`）：

```cpp
#if ENABLE(MEDIA_STREAM)
    state.add(computeCaptureState());
    if (m_activeSpeechRecognition)
        state.add(MediaProducerMediaState::HasActiveAudioCaptureDevice);
```

`m_activeSpeechRecognition` 在 `SpeechRecognition::didStartCapturingAudio()` 里设上。这个 flag 正是 `MediaProducer::MicrophoneCaptureMask` 的成员，往上进 `ActivityState::IsCapturingMedia`，再往上决定 UIProcess 侧的进程 assertion 和橙点指示器。**所以进程保活、静音、指示器这一整套，Web Speech 和 getUserMedia 走的是同一条。**

**② 没有「app 进后台就中止识别」的逻辑。**

唯一的自动中止是：

```cpp
void SpeechRecognition::suspend(ReasonForSuspension)
{
    abortRecognition();
}
```

`SpeechRecognition` 是 `ActiveDOMObject`，文档的 ActiveDOMObject 被挂起时识别直接 abort。但触发它的 `LocalFrame::suspendActiveDOMObjectsAndAnimations()`（`ReasonForSuspension::PageWillBeSuspended`）在全仓库只有三个调用点：`FrameIOS.mm` 里的 `LocalFrame::setTimersPaused()`、全屏视频控制器、以及一条要宿主显式发的 `WebPage::SuspendActiveDOMObjectsAndAnimations` 消息。而 `setTimersPaused` 只被 `Source/WebKitLegacy/mac/WebView/WebFrame.mm` 调用——**那是 UIWebView 的老路径，WKWebView 走不到**。

即：**WKWebView 里没有任何自动的「后台 → 挂起 → abort 识别」路径。** 类比 `AudioContext` 被 `PlatformMediaSessionManager` 在 hidden 时挂起那套机制，在 Web Speech 上不存在。

**③ 识别器本身跑在宿主 app 自己的进程里。**

`SpeechRecognitionServer`、`SpeechRecognitionPermissionManager`、`SpeechRecognitionRemoteRealtimeMediaSource(Manager)` 全在 `Source/WebKit/UIProcess/` 下——**UIProcess 就是宿主 app 进程**。`WebSpeechRecognizerTask`（持有 `SFSpeechRecognizer`）由 UIProcess 侧的 `SpeechRecognizer` 驱动。音频在 WebContent/GPU 进程采集，经 IPC 送到 UIProcess 喂给 `SFSpeechRecognizer`。

所以宿主 app 的 `UIBackgroundModes = audio` **直接覆盖识别器所在的进程**。这是这条路线相对「原生插件」形态的一个隐性优势：不需要额外为识别器争取后台运行时。

### 仍需实测的一处

WebContent / GPU 进程在宿主后台时会不会被挂起——这取决于 UIProcess 依据 `IsCapturingMedia` 取的进程 assertion 在后台是否继续持有。源码上 assertion 的输入条件（`HasActiveAudioCaptureDevice`）Web Speech 是满足的，和 getUserMedia 无差别；而团队已经查证 getUserMedia 在 audio 后台模式下继续工作。**所以推断成立，但这条推断链有一环是「A 成立且 B 与 A 同路径 ⇒ B 成立」，值得在 spike 里直接看一眼。**

另：老 API 的 `SFSpeechRecognitionTask` 自身在 app 进后台时会不会被 Speech 框架中止——**Apple 零文档、零 WWDC 陈述、论坛无回复。未查证。** 但 WebKit 把 `_setMaximumRecognitionDuration:` 设成 3600 秒说明框架侧没有短时限，而 Q8 的结论（设备端无配额）也说明没有服务端的会话回收机制。

## Q8 设备端识别还受不受每日配额

**不受。有官方明确说法。**

**WWDC 2019 session 256「Advances in Speech Recognition」**，讲 on-device recognition 时对着服务端那套限制（请求数上限 + 音频时长上限）明确说：**「these limits do not apply」**。同一场还给了：

- 「Over 10 languages supported for on-device recognition」（没列具体语言，中文是否在内**未查证**）
- 「All iPhones and iPads with Apple A9 or later processors are supported, and all Mac devices are supported」
- 「Your user's data will not be sent to Apple servers」「Your app no longer needs to rely on a network connection, and cellular data will not be consumed」
- 代价：「Accuracy is good on-device, but you may find it is better on server due to a continuous learning」「The number of languages supported on server are more than on-device」
- 「If server isn't available, our server mode automatically falls back on on-device recognition if it is supported」

旁证三条，方向一致：

1. Apple 文档里那段限流描述的**理由**就写着 `Because speech recognition is a **network-based** service, limits are enforced so that the service can remain freely available to all apps` —— 限流的正当性完全建立在「这是网络服务」上。
2. 云端配额有个流传的具体数字（引自 Apple 的答复，转载于 Stack Overflow 59117311）：「The current rate limit for the number of `SFSpeechRecognitionRequest` calls a device can make is **1000 requests per hour**. Please note this limit is on the number of requests that a device can make and is **not tied to the application** making it. This is regardless of the length of audio associated with the request. For a given `SFSpeechRecognitionRequest`, you are allowed up to one minute of audio per request.」**证据强度：转载的二手陈述，找不到 Apple 原始出处，未查证。**
3. WebKit 无条件把 `_setMaximumRecognitionDuration:` 设成 3600 秒，且在设备支持时强制 `requiresOnDeviceRecognition = YES`——一分钟上限是框架侧一个可设参数，不是服务端强制。有开发者在 Apple 论坛公开指出过这个不对等（thread 733564，2023-07：「In the WebKit web speech implementation, it looks like there are some extra setters for SFSpeechRecognizer exposing exactly this functionality… If it's available in WebSpeech, then why not in native applications?」），**Apple 至今没回**。

### 对我们的含义

Web Speech 路线上，只要设备 `supportsOnDeviceRecognition` 为真（WebKit 会自动开设备端），**每日配额这个风险不存在**，一分钟上限也不存在（WebKit 设了 3600 秒）。

风险只剩「设备/语言不支持设备端识别」这一种。那种情况下 WebKit 退回联网模式，配额和一分钟上限**都会回来**。

**怎么检测**：`supportsOnDeviceRecognition` 是原生 API，网页读不到。webview 里只能看症状——

- 撞配额：`SpeechRecognitionErrorEvent.error === 'network'` 或识别启动后一两秒内快速失败（Apple 文档原话：「If a recognition request fails quickly (within a second or two of starting), check to see if the recognition service became unavailable」）。
- 撞一分钟上限：`continuous = true` 时会话在约 60 秒处静默结束（WebKit 设了 3600 秒，所以只在联网模式下才可能撞到框架侧的其它限制）。

**最坏情况假设**：某台设备或某个 locale 不支持设备端识别 → 走云端 → 每小时 1000 次请求的设备级配额（数字未证实）+ 每次一分钟音频。对「念简报时随口插话」这种用法，一分钟上限比配额更致命。所以 spike 里必须验证目标设备上中文（`zh-CN`）确实走的是设备端——**判据是断网测试**：飞行模式下 `webkitSpeechRecognition` 还能出结果，就是设备端。

## 对形态结论的影响

前一轮建议的 spike 顺序不变，但内容要加两项：

1. 断网（飞行模式）下跑 `webkitSpeechRecognition`，`lang='zh-CN'` —— 验证走设备端，同时一次性排除配额和一分钟上限。
2. 同时开一条 `getUserMedia({audio:{echoCancellation:true}})` 和一个识别会话，确认两者共存、AEC 不掉。KWS 那条流**必须**请求 `echoCancellation:true`。
3. 切后台锁屏，看识别结果还出不出（宿主要先加 `UIBackgroundModes=audio`）。

三项都过，「全在 webview」形态成立，零原生代码。
