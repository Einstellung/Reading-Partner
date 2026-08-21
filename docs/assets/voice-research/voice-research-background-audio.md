# iOS 后台音频调研：锁屏念简报 + 随口打断

> 只读调研，2026-08-09 查证。每条外部事实带 URL 和证据强度：官方文档 / Apple DTS 回复 / 社区共识 / 单个帖子 / 未查证。
> 本机不能跑 iOS，所有结论来自文档和他人实测，没有一条是本项目实测过的。

---

## 结论

作废 2026-08-21：本节"不必搬到原生 Swift 侧"的结论已被推翻——docs/33 定的是全原生（「形态：全原生」）。下文的 Info.plist 合并顺序、wry 的媒体权限授予、iOS 26 保活线程数据仍然成立，是那个决定用到的证据。

场景成立。代价：Info.plist 加 `UIBackgroundModes = [audio]`，录音必须在前台按下才能带进后台，锁屏控件要另外接。

录音和播放**不必**搬到原生 Swift 侧——WKWebView 里的 `getUserMedia` 在宿主 app 声明了 audio 后台模式时继续工作。但如果决定搬一半，会比不搬更糟：宿主 app 改自己的 AVAudioSession 会打断 webview 的音频（见第 4 节）。要么全在 webview，要么全在原生，没有中间态。

---

## 现状（本仓库）

- 最低 iOS 16.0（`src-tauri/tauri.conf.json` → `bundle.iOS.minimumSystemVersion`）。
- 没有声明任何 `UIBackgroundModes`。
- `NSMicrophoneUsageDescription` 在 `src-tauri/Info.plist`（注释说是给 macOS 的，实际 iOS 也吃到，见下）。`Info.ios.plist` 只有 `ITSAppUsesNonExemptEncryption` 和 `CFBundleIconName`。
- `src-tauri/gen/apple` 不入库，CI 里 `tauri ios init --ci` 现生成（`.github/workflows/ios-testflight.yml`）。所以 Info.plist 的改动只能走 `src-tauri/Info.plist` / `Info.ios.plist`，手改 gen/apple 会被覆盖（坑 31 已记）。
- Tauri iOS 的 Info.plist 合并顺序（后者覆盖前者）：XcodeGen 的 project.yml 生成的 → `TAURI_DIR/Info.plist` → `TAURI_DIR/Info.ios.plist` → 只含版本号的内存版。
  证据：tauri issue 13068，引 `crates/tauri-cli/src/mobile/ios/build.rs#L193`。https://github.com/tauri-apps/tauri/issues/13068 （社区/维护者陈述）
- webview 层的媒体授权已经自动放行：wry 0.55.1 实现了 `webView:requestMediaCapturePermissionForOrigin:...` 并无条件返回 `WKPermissionDecision::Grant`
  （`~/.cargo/registry/.../wry-0.55.1/src/wkwebview/class/wry_web_view_ui_delegate.rs:126`）。系统级麦克风授权弹窗仍走 TCC，靠 `NSMicrophoneUsageDescription`。

---

## 1. 后台/锁屏播放音频

能。官方文档给的是完整配方。

- Info.plist：`UIBackgroundModes` 数组里加 `audio`。Xcode 里叫 "Audio, AirPlay, and Picture in Picture"，官方描述是 "The app plays audible content in the background."
  https://developer.apple.com/documentation/xcode/configuring-background-execution-modes （官方文档）
- AVAudioSession category：`.playback`（只播）或 `.playAndRecord`（要同时录）。两者的 discussion 里都有同一句：
  "To continue playing audio when your app transitions to the background (for example, when the screen locks), add the `audio` value to the `UIBackgroundModes` key in your information property list file."
  https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback
  https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord （官方文档）
- 激活：`setActive(_:options:)`，官方建议推迟到真正开始播放时再调，免得过早打断别人的后台音频。
  https://developer.apple.com/documentation/AVFoundation/configuring-your-app-for-media-playback （官方文档）
- mode：只播用 `.spokenAudio` 之类；要边播边录且要回声消除，见第 4 节。
- `.playAndRecord` 默认是 nonmixable，会打断别人正在放的音乐；要共存加 `mixWithOthers` 选项（官方文档，同上）。

WKWebView 里 `<audio>` 标签在后台被暂停曾是 iOS 13 的 bug，iOS 14.0 修好。
https://bugs.webkit.org/show_bug.cgi?id=203293 （Chris Dumez 2020-07-10 "The fix should be present in iOS 14 beta 2"；Calvin Ho 2020-09-21 "I confirm that this bug is fixed in iOS 14.0"，RESOLVED FIXED）

---

## 2. 后台/锁屏录音

能，但有一条硬规则：**录音必须在前台启动**。

Apple DTS 工程师原话：
> "An app must be in the foreground to start recording. If the app has specified the 'audio' background mode in its `info.plist` configuration, it can then continue recording when it moves into the background."
https://developer.apple.com/forums/thread/770556 （Apple DTS 回复）

另一位 DTS（Quinn "The Eskimo!"）：
> "we allow apps that start an audio recording session in the foreground to continue recording indefinitely in the background. That's visible to the user as the orange pill in the status bar."
https://developer.apple.com/forums/thread/776949 （Apple DTS 回复）

对场景的直接后果：用户不能在手机已经锁屏之后才第一次开麦。得在前台点"开始念"的时候就把 `getUserMedia`（或原生录音）拉起来并一直保持，然后再锁屏。中途如果流断了，后台不能重新拉。

**审核**：官方对 audio 后台模式的描述只写了播放，没写录音（见第 1 节引文）。同一个 776949 帖子的提问者就是**因为只用 audio 后台模式做后台录音被拒**：
> "the app was rejected because the audio background mode is only supposed to be used for audio playback."
Quinn 明确说自己不代表 App Review，没给出解法。
条款侧：2.5.4 "Multitasking apps may only use background services for their intended purposes: VoIP, audio playback, location, task completion, local notifications, etc."；2.5.14 "Apps must request explicit user consent and provide a clear visual and/or audible indication when recording... This includes any use of the device camera, microphone..."
https://developer.apple.com/app-store/review/guidelines/ （官方文档）

我们的姿态比那个被拒的 app 干净：主行为就是播放（念简报），录音是为了打断播放。审核材料要按"后台播放的语音助手"来写，别按"后台录音"来写。2.5.14 的可见指示由系统的橙点/橙条自动满足。

---

## 3. WKWebView 内部的 getUserMedia / MediaRecorder / AudioContext（最关键的一条）

结论：**宿主 app 声明了 `UIBackgroundModes = audio` 时，webview 里的麦克风采集在后台继续；没声明就被静音。** 这是 WebKit 有意为之的行为，不是 bug。

WebKit 工程师 youenn fablet 的陈述（bug 226620，2022-03-23）：iOS 上音轨被静音发生在 `UIBackgroundModes` 不含 "audio" 的情况；Mac 上不该被静音。bug 状态 RESOLVED / CONFIGURATION CHANGED。
https://bugs.webkit.org/show_bug.cgi?id=226620 （WebKit 工程师陈述，等同官方）

社区实测确认（Apple 论坛 689182）：
> "This appears to be working for me now. I'm using iOS 17.5.1. I had to add 'audio' to the UIBackgroundModes audio setting in Info.plist and then background audio would work the same as Safari." — aullman, 2024-08
同帖描述没加之前的症状：`applicationDidEnterBackground` 之后 `wkwebview.microphoneCaptureState` 很快变成 muted，用 `setMicrophoneCaptureState` 强设为 active 也没用。
https://developer.apple.com/forums/thread/689182 （单个帖子，但和 WebKit 工程师的说法互相印证）

注意这两条证据都停在 iOS 17.x。**iOS 18 及以后没查到确认或推翻的报告，我们自己也没实测过。这是本调研最大的未验证点。**

三个要留心的坑：

- **AudioContext 在后台会被挂起。** WebKit bug 237878 的原始描述：
  > "If page is backgrounded, AudioContext will be stopped even though AudioContext is not used directly for playing audio"
  > "AudioContext might be resumed by web page in case it can autoplay (for instance if page is continuing to capture audio, which allows to continue playing audio)."
  2022-03-17 修复落地（r291390），但帖子里用户报告到 iOS 16.3 仍然存在（Adrien iWebDJ, 2023-02-01）。
  https://bugs.webkit.org/show_bug.cgi?id=237878 （WebKit bugzilla）
  → 播 TTS 尽量走 `<audio>` / MediaSource 元素，别走 AudioContext 的 script 节点。麦克风持续采集本身也是让 AudioContext 能恢复的条件之一。

- **DOM 定时器在页面 hidden 时被节流到 1 秒对齐。** WebKit 的实现是把 fire time 对齐到 1 秒的整数倍。
  https://bugs.webkit.org/show_bug.cgi?id=98474 （WebKit bugzilla）
  → app 进后台后 webview 页面就是 hidden。任何靠 `setInterval` 驱动的编排（分片调度、心跳、超时）在后台精度掉到秒级。音频管线本身不受影响（由媒体线程驱动），网络回调和 WebSocket 消息也不是定时器。

- **JS 在后台被完全停掉的老结论不适用于我们。** Cordova CB-10657 "wkWebView disables JS execution when app is backgrounded"（2016 报，2022-09-06 Won't Fix）说的是**没有任何后台模式**的普通 app：整个进程被挂起。
  https://issues.apache.org/jira/browse/CB-10657 （社区，Won't Fix）
  iOS 13 时代那批 "WKWebView 后台音频停" 的帖子提到需要 `com.apple.multitasking.systemappassertions` 私有 entitlement，那是 iOS 13 的 bug，iOS 14 修掉了（见第 1 节）。现在仍能在日志里看到 `Failed to acquire RBS assertion 'WebKit Media Playback' ... doesn't have entitlement com.apple.runningboard.assertions.webkit` 这行报错，从 2023 到 2025 一直有人报，但音频照放；没有 Apple 回复也没有确认的解法。
  https://developer.apple.com/forums/thread/740354 （社区，无定论 → 当成噪音，别当阻塞）

**CPU 预算**：react-native-webrtc 有人在后台 15 秒左右被杀，日志是
> "Received (FATAL) CPU usage trigger: app used 9.00s of CPU over 9.57 seconds (averaging 94%), violating a CPU usage limit of 9.00s over 15 seconds."
https://react-native-webrtc.discourse.group/t/.../1227 （单个帖子）
→ 后台不能跑本地 ASR/TTS 推理。级联管线的 ASR 和 TTS 必须在云端，端上只做采集、播放、编排。docs/27 里"sherpa-onnx 端上流式 Zipformer"那条路在这个场景下用不了。

---

## 4. 要不要搬到原生 Swift

不必搬，而且**不能只搬一半**。

WKWebView 无视宿主 app 的 AVAudioSession category，7 年未修：
https://bugs.webkit.org/show_bug.cgi?id=167788 （WebKit bugzilla，状态 NEW，2017-02-03 报，2025-02-12 最后更新，无人认领）
反过来，宿主 app 把自己的 session 改成 `playAndRecord` 会打断 webview 正在放的音频（多个来源，包括 SO 72626836 和 dotnet/macios#18078）（社区共识）。

所以"原生持 AVAudioSession、webview 只做 UI"这条路不是绕开办法，它是主动制造冲突。两个可行形态：

**A. 全在 webview（推荐先试）**
只改 `src-tauri/Info.ios.plist` 加 `UIBackgroundModes = [audio]`，零原生代码。回声消除白拿（`getUserMedia` 的 `echoCancellation`，docs/27 已经确认这是手机侧比 Linux 桌面容易的原因）。风险是第 3 节那三个坑，以及 iOS 18+ 没有实测证据。

**B. 全在原生**
录音和播放都用 AVAudioEngine，webview 只做界面，音频数据走 IPC。回声消除要自己开：`AVAudioSession` 用 `.playAndRecord` + `.voiceChat` mode，再对 I/O 节点调 `setVoiceProcessingEnabled(true)`（iOS 13.0+）。
官方文档明说不开就没有：
> "For apps that use one or more chat modes (voice, video, or game), but don't use Audio Unit Voice I/O or AVAudioEngine with setVoiceProcessingEnabled(_:), the system reduces the processing it applies to audio signals. Specifically, it doesn't apply voice-specific processing, like echo cancellation and automatic gain correction..."
https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/voicechat
https://developer.apple.com/documentation/avfaudio/avaudioionode/setvoiceprocessingenabled(_:) （官方文档）
另外 `.voiceChat` 会自动加 `allowBluetoothHFP`，把路由收窄到适合语音的那几个——刷牙时用蓝牙耳机反而是好事，但会牺牲扬声器音质。

**原生代码怎么进 Tauri**：两条路。
- Tauri iOS 插件（Swift）。`tauri plugin new <name> --ios` 或对已有插件 `tauri plugin ios add`；`ios/` 是一个 Swift package（`--ios-framework spm`，默认）。Swift 侧继承 `Plugin` 类，命令是 `@objc public func foo(_ invoke: Invoke)`，用 `invoke.getString(...)` 取参、`invoke.resolve([...])` 回值，`trigger("event", data:)` 发事件；入口 `@_cdecl("init_plugin_<name>") func initPlugin(name: SRString, webview: WKWebView?)` 调 `Tauri.registerPlugin`。Rust 侧 `tauri::ios_plugin_binding!` + `api.register_ios_plugin(...)`，调用用 `PluginHandle::run_mobile_plugin("openCamera", payload)`。权限重写 `checkPermissions()` / `requestPermissions()`。
  https://v2.tauri.app/develop/plugins/develop-mobile/ 和 https://v2.tauri.app/develop/plugins/ （官方文档）
- 纯 Rust 走 objc2 绑定，不写 Swift：`objc2-avf-audio` 0.3.2（AVFAudio）和 `objc2-media-player` 0.3.2（MediaPlayer），都是 2025-10-04 发布。
  https://crates.io/crates/objc2-avf-audio https://crates.io/crates/objc2-media-player （crates.io，2026-08-09 查）
  这条路免掉 Swift package 和插件脚手架，但 AVAudioEngine 的回调式 API 用 objc2 写会难看。**没查证是否有人真这么干过。**

---

## 5. 锁屏 Now Playing 和控制中心

两条路，取决于第 4 节选 A 还是 B。

**A（webview）：用 Media Session API。** 页面里 `navigator.mediaSession.metadata = new MediaMetadata({title, artist, artwork})` 和 `setActionHandler('play'|'pause'|'nexttrack'|'previoustrack'|'seekforward'|'seekbackward', fn)`，WebKit 把它接到 iOS 锁屏的 Now Playing 界面上。
- iOS Safari 支持并显示在锁屏上；artwork 曾经有 bug，WebKit bug 251782 → Sam Sneddon 2023-02-06 "I believe the fix for this shipped last month in iOS 16.3"。
  https://bugs.webkit.org/show_bug.cgi?id=251782 （WebKit bugzilla）
- 独立实测记录：artwork 一路到 iOS 18 才彻底修好（"iOS 18 appears to have fixed the low-resolution artwork issue"），action handler（seekforward/seekbackward/上下条）可用。
  https://dbushell.com/2023/03/20/ios-pwa-media-session-api/ （单个帖子，测的是 Safari/PWA）
- **没查到 Media Session API 在 WKWebView（而非 Safari/PWA）里是否同样接到锁屏。这是未验证点。**
- 天然契合我们要的："正在念第 3 条" 写进 `title`，`nexttrack` 绑到"跳过这条"。

**B（原生）：`MPNowPlayingInfoCenter.default().nowPlayingInfo` 字典 + `MPRemoteCommandCenter`。**
官方："The system displays Now Playing information on the device's Lock Screen and in the media controls in Control Center."
要填的键：`MPMediaItemPropertyTitle`、`MPMediaItemPropertyArtist`、`MPMediaItemPropertyArtwork`、`MPMediaItemPropertyPlaybackDuration`、`MPNowPlayingInfoPropertyElapsedPlaybackTime`、`MPNowPlayingInfoPropertyPlaybackRate`。官方建议"provide values for as many information properties as you can"。
https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter （官方文档）

两条路不要同时走：webview 的媒体元素会自己往 Now Playing 里写，原生再写一遍会打架（**未查证具体表现**）。

---

## 6. 后台音频有没有时长上限

没有固定上限，但不是"保证不被杀"。Apple DTS 原话：
> "Strictly speaking, no. The 'audio' background category allows your app to remain awake while your audio session is active, which isn't quite the same as guaranteeing it will not be suspended."
被挂起的实际原因，同一条回复列的：
1. 发生中断（interruption）后 app 没有正确恢复播放；
2. app 停止出声"太久"，系统触发中断且再没恢复；
3. 系统为维护而终止 app（比如要清 tmp/Caches）；
4. 内存占用高，后台内存尖峰会招来终止；
5. 设备重启。
https://developer.apple.com/forums/thread/764096 （Apple DTS 回复）

对场景的后果：**念完一条到念下一条之间不能长时间静音**。如果要"念完等用户提问"，那段静默期得垫一段无声音频或保持 session 活跃，否则可能被判定为停止播放而挂起。这是设计要处理的，不是自然成立的。
另外中断处理（`AVAudioSession.interruptionNotification`，来电、闹钟、Siri）必须写对，否则中断结束后就再也醒不过来了——这是 DTS 列的第一条原因。

有人报告 audio-only 模式约 8-9 分钟被挂起（https://github.com/Intent-Lab/VisionClaw/issues/37），但没有任何证据支撑，看上去正是上面第 2 条（静音太久）的表现。**当成传闻，不当成上限。**

iOS 26 新增的 `BGContinuedProcessingTask` 被 DTS 在另一个帖子里推荐为"后台保持数分钟"的替代方案（https://developer.apple.com/forums/thread/840384），**没深入查证**，也不适合我们（我们要的是持续播放，不是有限时长的处理）。

---

## 落地顺序（如果要做）

1. `src-tauri/Info.ios.plist` 加 `UIBackgroundModes = [audio]`；确认 `NSMicrophoneUsageDescription` 在 iOS 包里（现在在 `Info.plist`，按合并顺序会进 iOS，**建议同时写进 `Info.ios.plist` 免得哪天 macOS 那份被改动**）。
2. 发一个 TestFlight 包，只验三件事：前台起 `getUserMedia` → 锁屏 → 麦克风是否还在（橙点在不在、云端 ASR 还有没有收到音）；`<audio>` 播放锁屏后是否继续；`navigator.mediaSession` 写的标题在锁屏上出不出来。
   这三条本调研全部拿不到 iOS 18+ 的证据，必须实测。
3. 三条都过 → 走形态 A，零原生代码。任何一条不过 → 才考虑形态 B，并按第 4 节整体搬，不搬一半。

## 未查证清单

- iOS 18 / 26 上 WKWebView 后台 `getUserMedia` 是否仍随 audio 后台模式工作（证据最新只到 17.5.1）。
- Media Session API 在 WKWebView（非 Safari/PWA）里能否驱动锁屏 Now Playing。
- webview 媒体元素自动写的 Now Playing 与原生 `MPNowPlayingInfoCenter` 同时存在时的表现。
- 用 objc2 从 Rust 直接驱动 AVAudioEngine + 语音处理，有没有可参考的先例。
- 后台静音多久会被系统判定为"停止播放"，Apple 没给数字。
- App Review 对"以播放为主、录音为打断手段"的实际态度，只有一个反面案例（776949 被拒）和条款文本。
