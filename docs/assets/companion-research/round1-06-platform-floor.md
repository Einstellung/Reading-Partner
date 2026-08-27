# Round 1 / 6 — 平台地板：iOS/iPadOS 26 与 Tauri v2 允许什么

> 第一轮调研，2026-08-26 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度原题：The platform floor: what iOS/iPadOS 26 and Tauri v2 actually permit for a talking, animated in-app companion

---

## Headline

The brief is out of date — Reading-Partner already ships a native iOS audio+ASR stack (`plugins/voice`: AVAudioEngine + voice-processing AEC + on-device SpeechAnalyzer, measured on iPhone 16/iOS 26.6), so the platform floor question is no longer "can we get audio" but "can we hold the microphone open continuously with the orange indicator lit, and can we composite an animated character over the PDF inside a WebView that Tauri cannot make transparent."

## Relevance to this repo

The audio half of this feature is mostly already paid for: `plugins/voice` is a shipping Tauri iOS Swift plugin with AVAudioSession `.playAndRecord`/`.voiceChat`/`.defaultToSpeaker`, hardware AEC via `setVoiceProcessingEnabled(true)`, on-device SpeechAnalyzer, and a four-kind event stream to JS — so a talkable companion inherits capture, echo cancellation and ASR for free and only needs an output path and turn-taking. What it costs to adopt is discipline about one rule: WKWebView ignores the host AVAudioSession category (WebKit 167788, unowned since 2017), so TTS playback must go native through the same AVAudioEngine graph, not through `<audio>` or WebAudio in the page, or the two sessions will fight. Expect two concrete design constraints from the measurements: an always-ready companion means the orange indicator is lit for the whole reading session (the 690 ms VPIO build cannot be pre-paid without lighting it), and a companion that talks while backgrounded must be reviewed as background playback with barge-in, never as background listening. Also note the CSP in `tauri.conf.json` has no `media-src`, so it falls back to `default-src 'self'` and any blob-URL audio you try to play in the page is blocked — one more reason to keep output native. The character half is where real new cost lives: Tauri cannot make the iOS WebView transparent (tauri#10152, open since June 2024, no PR), so a native UIView composited over the WebView is not an off-the-shelf path and the character has to be a sibling DOM/canvas layer promoted with `transform: translateZ(0)` — cheap for the sprite, but never promote the text layer, since the repo already measured composited layers dropping subpixel antialiasing. Rendering itself is comfortable: WebGL2 has been there since iOS 15 and WebGPU is on by default in WKWebView on iOS 26, which the app already targets as its minimum; Live2D via `untitled-pixi-live2d-engine` (MIT, PixiJS v8, Cubism 5) costs nothing in licence at this revenue scale and single-digit MB against a 4 GB cap. Two traps to design around on iPad specifically: the system selection callout is a 44 px UIKit bar floating over the WebView that the DOM cannot see and that swallows touches, and `crossOriginIsolated` is false under `tauri://` so there is no SharedArrayBuffer for an AudioWorklet ring buffer or threaded WASM in the page.

## Findings

### The premise "no audio at all" is false: the repo already contains a working custom iOS Swift Tauri plugin that captures the mic with echo cancellation and transcribes on-device.


`plugins/voice/` is a full Tauri iOS plugin (743-line AudioFront.swift, 1168-line DictationRun.swift, 272-line VoicePlugin.swift, plus a Rust bridge and a permissions manifest). It configures `AVAudioSession(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker])`, calls `input.setVoiceProcessingEnabled(true)` for hardware AEC/AGC, installs a tap at `bufferSize: 4096` on the hardware format, and feeds `SpeechAnalyzer` + `SpeechTranscriber` (iOS 26 Speech framework) with `reportingOptions: [.volatileResults, .fastResults]`. It streams four event kinds to JS via `addPluginListener('voice','dictation')`: volatile, final, level (~10 Hz), timing. `src-tauri/tauri.conf.json` already sets `bundle.iOS.minimumSystemVersion = "26.0"`, and `Info.ios.plist` already carries NSMicrophoneUsageDescription. Everything below should be read as "what the existing stack does and does not already permit," not as greenfield.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/plugins/voice/README.md
- Date: 2026-08-22
- Confidence: high
- Runs on device: ios-yes

### The hard latency floor for opening the microphone is 1082 ms cold / 304 ms warm, and ~690 ms of the cold path is `setVoiceProcessingEnabled(true)` rebuilding the voice-processing IO unit.


Measured in-repo on iPhone 16 / iOS 26.6, 28 real holds: press-to-first-audio-buffer median 1082 ms (range 490–1277) when the stack is rebuilt per press vs 304 ms (120–316) when inherited; sentence-head survival 2/13 vs 9/9. Step breakdown from one cold press: permission +0 ms, session configure+activate +75 ms, `setVoiceProcessingEnabled(true)` returns +769 ms, installTap+`engine.start()` +950 ms, first buffer +1063 ms. The recognizer half (locale, model, `bestAvailableAudioFormat`, `prepareToAnalyze`, `analyzer.start`) is only 80–180 ms. A pre-roll queue between the two halves recovered nothing (4 of 5 presses buffered 0 frames). For a companion you barge into, the only way to hit sub-300 ms is to keep the engine alive with `pause()`, never `stop()`.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/166-the-microphone-opens-after-the-user-has-started-talking.md
- Date: 2026-08-22
- Confidence: high
- Runs on device: ios-yes

### The orange microphone indicator lights at `engine.start()`, not at `setActive(true)` — so an always-ready companion is an always-orange-dot companion, and there is no way around it.


Measured in-repo with a four-stage probe (off / session / engine / tap / recording), because Apple documents what the indicator means but never what triggers it. VPIO cannot be built until the engine runs, so the 690 ms cannot be paid in advance without lighting the dot. Only two shapes exist: light it on entering voice mode (dot on before the user speaks), or build on first hold and `pause()` after (dot on from the user's first word until voice mode ends). The repo took the second. A persistent "talk to me any time" companion collapses these into one: the dot is lit for the whole reading session. That is also exactly what App Store guideline 2.5.14 wants (visible indication while recording), so it is a UX cost, not a review risk.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/167-the-microphone-indicator-lights-at-engine-start.md
- Date: 2026-08-22
- Confidence: high
- Runs on device: ios-yes

### getUserMedia in a Tauri iOS WebView does work: all three gates are already passed, contrary to the widely repeated "custom schemes are not secure contexts" claim.


Gate 1, WKUIDelegate: wry 0.55.1 implements `webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:` and unconditionally calls back `WKPermissionDecision::Grant`. The method carries no `#[cfg(target_os = "macos")]` guard (unlike the file-panel and new-window methods in the same impl block), so it applies on iOS. Gate 2, secure context: Tauri serves the app from `tauri://localhost` on iOS/macOS (`tauri_protocol_url()` returns `http(s)://tauri.localhost` only on Windows and Android). WebKit's `shouldTreatAsPotentiallyTrustworthy` returns true on `SecurityOrigin::isLocalHostOrLoopbackIPAddress(host)` with no scheme check preceding it, so `tauri://localhost` is a secure context and `navigator.mediaDevices` exists. Gate 3: NSMicrophoneUsageDescription in Info.ios.plist. The private `_registerURLSchemeAsSecure` workaround that blog posts recommend is unnecessary here.

- Source: https://github.com/tauri-apps/wry/blob/dev/src/wkwebview/class/wry_web_view_ui_delegate.rs
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Splitting audio between the WebView and native Swift is actively worse than either extreme: WKWebView ignores the host app's AVAudioSession category, and the host changing it interrupts WebView audio.


WebKit bug 167788 ("WKWebView seems to ignore AVAudioSession category settings in iOS app") was filed 2017-02-03, is still status NEW, and was last touched 2025-02-12 — eight years unowned, no workaround in thread. Conversely, a host app that sets `.playAndRecord` interrupts audio the WebView is playing. So the choice is all-in-webview (Web Audio + getUserMedia, echo cancellation via the `echoCancellation` constraint) or all-native (AVAudioEngine both directions, WebView is UI only). The repo already chose all-native. Any design that adds, say, WebAudio TTS playback on top of the existing native capture will fight the native session.

- Source: https://bugs.webkit.org/show_bug.cgi?id=167788
- Date: 2025-02-12
- Confidence: high
- Runs on device: ios-yes

### Background talking is possible but narrow: capture must start in the foreground, needs UIBackgroundModes=[audio], and using that mode for recording is a documented rejection reason.


Apple DTS (Quinn): "we allow apps that start an audio recording session in the foreground to continue recording indefinitely in the background. That's visible to the user as the orange pill in the status bar." A second DTS reply says the same with the background-mode requirement spelled out. But the questioner in that same thread was rejected because "the audio background mode is only supposed to be used for audio playback" — guideline 2.5.4 lists intended purposes as "VoIP, audio playback, location, task completion, local notifications". For WebView capture specifically, WebKit deliberately mutes the track in background unless the host declares the `audio` mode (WebKit engineer youenn fablet, bug 226620, RESOLVED/CONFIGURATION CHANGED); community confirmation stops at iOS 17.5.1 and nothing confirms or refutes it for iOS 18–26. A companion that speaks while backgrounded is framed as background playback with barge-in, never as background listening.

- Source: https://developer.apple.com/forums/thread/776949
- Date: 2026-01
- Confidence: high
- Runs on device: ios-yes

### A locked screen takes the microphone with no interruption notification at all — the app must subscribe to didEnterBackgroundNotification to notice.


Measured in-repo: on auto-lock the app is backgrounded, the input route becomes `in=[]`, the tap stops delivering buffers entirely, yet `interruptionNotification` never fires and `engine.isRunning` is still true. The stack looks healthy and is dead. The plugin now watches three separate signals — interruption began, input route went empty, and app left screen — and tears down on any of them between holds. Also relevant: `engine.start()` throws OSStatus 561145187 ('!rec') because iOS has refused to start recording from the background since 12.4, so a stream that breaks in the background cannot be restarted there.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/162-a-locked-screen-takes-the-microphone-without-an-interruption.md
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Tauri v2 Channel does carry raw bytes to JS as an ArrayBuffer, but the thresholds are 1024 bytes (raw) and 8192 bytes (JSON) — above them every message costs an extra IPC round trip.


From tauri 2.11.5 source: `MAX_RAW_DIRECT_EXECUTE_THRESHOLD = 1024`, `MAX_JSON_DIRECT_EXECUTE_THRESHOLD = 8192`. Under the threshold the payload is inlined into a `webview.eval` (raw bytes as a JSON number array wrapped in `new Uint8Array(...).buffer`); over it, Rust stashes the body and evals an `invoke('plugin:__TAURI_CHANNEL__|fetch', ...)` that the JS side must round-trip. Independent end-to-end Tauri IPC measurements on macOS aarch64: 25 B = 300 µs, ~1 KB = 400 µs, 64 KB = 6.7 ms, with the note that "for small payloads, the WebView bridge overhead (~1-5 ms) dominates." 16 kHz/16-bit mono PCM is 32 KB/s, so a 100 ms chunk is 3.2 KB raw / 4.3 KB base64 — under the JSON threshold, 10 messages/s, comfortable. A 20 ms chunk at 50/s is also under, but pays 50 evals/s.

- Source: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs
- Date: 2026-07
- Confidence: high

### On iOS specifically, a Swift plugin's channel data crosses into Rust as a JSON C-string, so there is no binary path from Swift to JS — PCM must be base64 or a number array.


tauri 2.11.5's iOS bridge declares `ChannelSendDataCallbackFn = unsafe extern "C" fn(c_ulonglong, *const c_char)`; the handler does `CStr::from_ptr(payload)` then `serde_json::from_str` into a `serde_json::Value` and sends that on a `Channel<serde_json::Value>`. Command responses cross the same way (`plugin_command_response_handler(c_int, c_int, *const c_char)`). So the Rust-side raw-bytes path exists but a Swift plugin cannot reach it. This is the concrete reason to keep audio entirely native and send only text and small events across — which is what `plugins/voice` already does (volatile/final/level/timing, no samples).

- Source: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/plugin/mobile.rs
- Date: 2026-07
- Confidence: high
- Runs on device: ios-yes

### Tauri cannot make the iOS WebView transparent, so a native UIView composited over the WebView is not a supported path — the character must be a DOM or canvas layer inside the page.


tauri#10152 "[feat] Support transparent webviews on mobile", opened 2024-06-29, still open, no assignee, no PR, both android and ios labels. `WebviewWindowBuilder::transparent` is desktop-only in Tauri even though wry supports transparency on mobile underneath. Third-party plugins do reach into the WKWebView (e.g. tauri-plugin-ios-webview-insets sets `scrollView.contentInsetAdjustmentBehavior = .never`), so a bespoke plugin could add a sibling UIView, but nothing off-the-shelf does it and you would then own the z-order, hit-testing and rotation yourself.

- Source: https://github.com/tauri-apps/tauri/issues/10152
- Date: 2024-06-29
- Confidence: high
- Runs on device: ios-no

### WebGPU is enabled by default in WKWebView on iOS 26 — Safari feature flags never applied to WKWebView, and "enabled by default" was the only gate.


Apple engineer, Developer Forums thread 770862, June 2025: "These feature flags only impact Safari and not WebKit generally. For WKWebView, the feature will work when it's enabled by default," with the recommendation to test on the iOS 26 beta where WebGPU is on by default. WebKit's WWDC25 post confirms WebGPU shipping in Safari 26 for macOS, iOS, iPadOS and visionOS and states it "supersedes WebGL" on Apple platforms, with Three.js, Babylon.js and PlayCanvas working. Reading-Partner's deployment target is already iOS 26.0, so both WebGL2 (since iOS 15) and WebGPU are available in-app. Blog claims that "iOS WKWebView does not ship WebGPU on by default" are describing pre-26 behavior.

- Source: https://developer.apple.com/forums/thread/770862
- Date: 2025-06
- Confidence: medium
- Runs on device: ios-yes

### COOP/COEP do not grant cross-origin isolation under `tauri://` on iOS — measured `crossOriginIsolated === false` and `SharedArrayBuffer === undefined` on a real iPad WKWebView.


Measured in-repo on the iPad simulator running the real WKWebView with the app's `tauri://` custom protocol, despite `app.security.headers` setting COOP=same-origin and COEP=require-corp in tauri.conf.json (which does work on desktop WebKitGTK). Consequences for a companion: no SharedArrayBuffer ring buffer between an AudioWorklet and the main thread, and no multi-threaded WASM — so an in-webview whisper.cpp / sherpa-onnx / VAD build gets one thread. PDFium still rendered fine in the same run (engineReady 256 ms, open 12 ms, render 730 ms) because that wasm is not a pthread build. COEP=require-corp does still block cross-origin subresources, which is why external images route through a Rust `img:` scheme.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/33-ios-no-cross-origin-isolation-still-renders.md
- Date: 2026-06
- Confidence: high
- Runs on device: ios-yes

### On iPad, the system's selection callout is a UIKit view floating above the WKWebView that the DOM cannot see and that swallows touches — a character parked near a text selection loses 37 of its 44 px.


Measured in-repo on a real iPad: the `Copy | Look Up | Translate` bar is 44 px tall, sits 15 px from the selection, flips above/below depending on whether the selection centre is above the safe-area vertical midpoint, and is clamped horizontally into the screen. It is absent from the DOM, invisible to `elementFromPoint`, and touches landing on it never reach the page. The repo already deleted one floating control for this reason (2026-08-20). A draggable companion has to either avoid the selection neighbourhood or be re-measured against both placements.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/143-ios-puts-its-selection-callout-below-the-selection.md
- Date: 2026-08-20
- Confidence: high
- Runs on device: ios-yes

### Promoting the character to its own compositor layer is the right move for scroll performance but flips text rendering from subpixel to grayscale antialiasing — so promote the character, never the page.


WKWebView's long-standing `position: fixed` behavior is flicker and detachment during inertial scroll; the standard fix is `transform: translateZ(0)` or `will-change: transform` to force a separate compositor layer, plus keeping fixed elements at body level rather than inside scroll containers. The repo measured the cost directly: Radix's popper uses `transform: translate(x,y)`, which makes the overlay a composited layer, and the engine drops LCD subpixel antialiasing for grayscale — edge pixels went from (133,204,242) to (212,212,212) on identical glyphs at identical positions. `filter: blur()` / `backdrop-filter: blur(20px)` are separately called out as frame-droppers on older devices.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/86-transformed-popper-drops-subpixel-text.md
- Date: 2026-05
- Confidence: high
- Runs on device: ios-yes

### A backgrounded companion cannot drive anything from JS timers: WebKit aligns DOM timer fire times to 1-second boundaries when the page is hidden, and the background CPU watchdog kills at ~9 s of CPU over 15 s.


WebKit bug 98474 implements hidden-page timer throttling by aligning fire time to whole seconds; the app's WebView page is hidden the moment the app backgrounds, so setInterval-driven orchestration (chunk scheduling, heartbeats, timeouts) degrades to second granularity. Audio pipelines themselves are driven by media threads and are unaffected, as are network callbacks and WebSocket messages. Separately, a react-native-webrtc report captures the watchdog message verbatim: "app used 9.00s of CPU over 9.57 seconds (averaging 94%), violating a CPU usage limit of 9.00s over 15 seconds." Practical rule: no on-device ASR/TTS inference in the background — capture, playback and orchestration only, inference in the cloud.

- Source: https://bugs.webkit.org/show_bug.cgi?id=98474
- Date: 2026-08-09
- Confidence: medium
- Runs on device: ios-yes

### A MediaStream cannot be handed from the WebView to the host app or vice versa, so "WebView captures, native recognizes" is structurally impossible.


From the repo's own prior WebKit-source research: MediaStream exists only inside the WebKit content process (`RealtimeMediaSource`, `SpeechRecognitionRemoteRealtimeMediaSourceManager`) and no public interface exports it to the embedding app; the reverse direction (feeding host-captured audio into the WebView) has no interface either. The same research notes that Web Speech in WKWebView and page-level getUserMedia share one `CoreAudioCaptureSource` and therefore one VPIO unit, which is why a page-level keyword-spotting stream must also request `echoCancellation: true` or it tears AEC out of the whole process.

- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/assets/voice-research/voice-research-apple-asr.md
- Date: 2026-08-21
- Confidence: medium
- Runs on device: ios-yes

### No Tauri plugin streams live audio frames to JS; the existing audio plugins are file-based, and the one streaming STT plugin is push-to-talk on the older SFSpeechRecognizer API.


`tauri-plugin-audio-recorder` uses AVAudioRecorder on iOS, writes M4A/AAC files at quality presets low (16 kHz mono) / medium (44.1 kHz mono) / high (48 kHz stereo), requires NSMicrophoneUsageDescription, and documents no chunk streaming — `stopRecording()` returns file metadata. `tauri-plugin-mic-recorder` is cpal+hound, desktop-shaped. `tauri-plugin-stt` (MIT) does emit `stt://result` events with `{transcript, isFinal, confidence}` from SFSpeechRecognizer on iOS, but its model is start_listening/stop_listening, and on iOS its model-management commands are no-ops. None of them beat what `plugins/voice` already does with SpeechAnalyzer.

- Source: https://github.com/brenogonzaga/tauri-plugin-audio-recorder
- Date: 2026
- Confidence: medium
- Runs on device: ios-yes

### App size is a non-issue for a sprite or Live2D character: the cap is 4 GB uncompressed, and the only tight limit (80 MB of __TEXT) is code, not assets.


Apple's App Store Connect reference: iOS 9.0+ minimum deployment target gives a 4 GB maximum uncompressed app size and an 80 MB maximum for the total of all `__TEXT` sections in the binary. The separate cellular-download limit is 200 MB (raised from 150 MB in May 2019), and since iOS 13 the user can override it per download. Apple points at Background Assets for anything larger. A Live2D model with 4096 px atlases lands in single-digit MB; the Cubism Core runtime is a few hundred KB of JS.

- Source: https://developer.apple.com/help/app-store-connect/reference/maximum-build-file-sizes/
- Date: 2026
- Confidence: high

### Live2D is free for this project: the SDK Release License is required only at publication and individuals and small-scale enterprises (annual revenue under ¥10,000,000) are exempt.


Live2D's SDK page: "Individuals and small-scale businesses are exempt from the license agreement and payment (excluding Expandable Application)" and the license is "only required upon releasing your content. Not during trial or development." The ¥10M threshold is the definition Live2D uses for Cubism PRO for indie eligibility. Paid tiers for reference: one-time non-console content plan is ¥100,000 (middle-scale) / ¥600,000 (large-scale). Runtime options: `untitled-pixi-live2d-engine` (MIT, PixiJS v8, Cubism 2.1/3/4/5, needs the proprietary `live2dcubismcore.min.js` loaded separately) or `pixi-live2d5`. The commonly cited `pixi-live2d-display` is PixiJS v6, no Cubism 5, and was last published about four years ago.

- Source: https://www.live2d.com/en/sdk/license/
- Date: 2026
- Confidence: medium
- Runs on device: ios-yes

## Numbers

### Press to first audio buffer, microphone stack rebuilt each press (iPhone 16, iOS 26.6, n=13)

- Value: 1082 ms median, range 490–1277 ms; transcript head intact 2/13
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/166-the-microphone-opens-after-the-user-has-started-talking.md

### Press to first audio buffer, microphone stack inherited (iPhone 16, iOS 26.6, n=9)

- Value: 304 ms median, range 120–316 ms; transcript head intact 9/9
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/166-the-microphone-opens-after-the-user-has-started-talking.md

### Cost of setVoiceProcessingEnabled(true) alone (rebuilds the VPIO unit)

- Value: ~690 ms
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/166-the-microphone-opens-after-the-user-has-started-talking.md

### Recognizer half of startup (locale, model, bestAvailableAudioFormat, prepareToAnalyze, analyzer.start)

- Value: 80–180 ms
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/166-the-microphone-opens-after-the-user-has-started-talking.md

### Tauri Channel: raw-bytes payload size above which an extra IPC round trip is added

- Value: 1024 bytes (MAX_RAW_DIRECT_EXECUTE_THRESHOLD)
- Source: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs

### Tauri Channel: JSON payload size above which an extra IPC round trip is added

- Value: 8192 bytes (MAX_JSON_DIRECT_EXECUTE_THRESHOLD)
- Source: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs

### Tauri IPC end-to-end latency baseline, macOS aarch64

- Value: 25 B = 300 µs; ~1 KB = 400 µs; 64 KB = 6.7 ms
- Source: https://github.com/userFRM/tauri-conduit/blob/master/BENCHMARKS.md

### Audio bitrate the IPC has to carry if PCM crosses to JS (16 kHz, 16-bit, mono)

- Value: 32 KB/s raw = 42.7 KB/s base64; a 100 ms chunk is 3.2 KB raw / 4.3 KB base64
- Source: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/ipc/channel.rs

### iOS background CPU watchdog kill threshold

- Value: 9.00 s of CPU over 15 s (observed: 9.00 s over 9.57 s, 94% average)
- Source: https://developer.apple.com/forums/thread/776949

### WKWebView audio tap buffer size used by the shipping plugin

- Value: 4096 frames at hardware format
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/plugins/voice/ios/Sources/AudioFront.swift

### Volatile ASR result throttling needed (results arrive in bursts, six in one millisecond)

- Value: throttled to 10 Hz outbound; finals never throttled
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/160-volatile-results-arrive-in-bursts.md

### Maximum uncompressed iOS app size (deployment target iOS 9.0+)

- Value: 4 GB
- Source: https://developer.apple.com/help/app-store-connect/reference/maximum-build-file-sizes/

### Maximum total __TEXT sections in the iOS binary

- Value: 80 MB
- Source: https://developer.apple.com/help/app-store-connect/reference/maximum-build-file-sizes/

### App Store cellular download limit (user-overridable since iOS 13)

- Value: 200 MB
- Source: https://appleinsider.com/articles/19/05/31/apple-bumps-up-4g-app-store-download-limit-for-iphones-ipads-to-200mb

### Live2D SDK Release License exemption threshold

- Value: annual revenue under ¥10,000,000 (individuals and small-scale enterprises pay nothing)
- Source: https://help.live2d.com/en/store/store_29/

### Live2D paid tiers, one-time purchase, non-console content

- Value: ¥100,000 middle-scale / ¥600,000 large-scale
- Source: https://www.live2d.com/en/sdk/license/purchase_plan02/

### WebKit bug 167788 (WKWebView ignores host AVAudioSession category) age

- Value: filed 2017-02-03, status NEW, last modified 2025-02-12
- Source: https://bugs.webkit.org/show_bug.cgi?id=167788

### iPad system selection callout dimensions (invisible to the DOM, eats touches)

- Value: 44 px tall, 15 px from the selection, flips above/below at the safe-area vertical midpoint
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/143-ios-puts-its-selection-callout-below-the-selection.md

### PDFium render timings measured in the real iPad WKWebView under tauri://

- Value: engineReady 256 ms, open 12 ms, render 730 ms (200×200)
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/docs/pitfall/33-ios-no-cross-origin-isolation-still-renders.md

### OSStatus returned when AVAudioEngine.start() is called from the background

- Value: 561145187 ('!rec') — iOS has refused since 12.4
- Source: file:///home/xinyuan/Documents/Github/Reading-Partner/plugins/voice/ios/Sources/AudioFront.swift

## Fact-check

### 4. getUserMedia works in a Tauri iOS WebView: wry 0.55.1's WKUIDelegate impl of requestMediaCapturePermissionForOrigin:...decisionHandler: has no target_os="macos" cfg guard (applies on iOS) and grants; Tauri serves tauri://localhost on iOS/macOS (not http(s)://tauri.localhost, which is Windows/Android only); NSMicrophoneUsageDescription is present.

- Verdict: **corrected**

Evidence: Fetched raw wry source (github.com/tauri-apps/wry, dev branch, src/wkwebview/class/wry_web_view_ui_delegate.rs). Confirmed: this method (line 130) has no target_os="macos" guard, unlike the file-panel method (line 99-100) and create_web_view_for_navigation_action (line 171) in the same impl block -- that part of the claim is accurate. HOWEVER the grant is NOT unconditional as stated: the code is `let decision = if let Some(handler) = &self.ivars().permission_handler { ...translate handler response... } else { WKPermissionDecision::Grant }` (lines 140-166) -- it only defaults to Grant when no permission_handler is registered; otherwise it defers to whatever handler Tauri wires up via with_permission_handler (tauri-runtime-wry/src/lib.rs:4894-4899). Checked this repo's src-tauri: no on_permission_request/with_permission_handler/permission_request_handler registration exists anywhere, so in THIS specific codebase the else-branch (unconditional Grant) is indeed what runs today -- the practical conclusion holds for Reading-Partner as currently built, but the report's description of wry's behavior itself ('unconditionally calls back Grant') is imprecise/overstated as a general claim about the library. The tauri://localhost (not http(s)://tauri.localhost) claim is corroborated by tauri-utils/src/config.rs doc comments: 'https://<scheme>.localhost instead of the default http://<scheme>.localhost on Windows and Android' vs '...used on macOS and Linux', and wry's wkwebview module (shared between macOS and iOS, distinct from its android module) contains no https-scheme conversion logic -- consistent with iOS behaving like macOS, though no line explicitly names iOS.

### N7. Independent Tauri IPC benchmark (tauri-conduit repo), macOS aarch64: 25B=300µs, ~1KB=400µs, 64KB=6.7ms, with note that WebView bridge overhead dominates for small payloads.

- Verdict: **corrected**

Evidence: Fetched raw.githubusercontent.com/userFRM/tauri-conduit/master/BENCHMARKS.md: the Tauri row does show 25B~300µs, ~1KB~300-400µs, 64KB=6.700ms -- the core numbers in the claim are accurate. However this is a single unaffiliated community/personal benchmark repo (github user 'userFRM'), not an official Tauri source -- should be weighted accordingly. Also, the specific quoted phrase the report attaches to these numbers ('the WebView bridge overhead (~1-5 ms) dominates') is real text in the document but appears in a different, earlier 'Measurement scope' section describing a general/theoretical framing (which explicitly says it EXCLUDES bridge overhead from its own Rust-only numbers), not attached to this particular end-to-end table; the sentence actually adjacent to this table says overhead is '(~300us)', not '~1-5ms'. The report conflated two sections' phrasing -- a minor misquote, not a wrong number.

### N9. iOS background CPU watchdog kill threshold = 9.00s of CPU over 15s (observed: 9.00s over 9.57s, 94% average), cited to developer.apple.com/forums/thread/776949.

- Verdict: **refuted**

Evidence: Two independent targeted fetches of developer.apple.com/forums/thread/776949 (the exact cited URL) found no mention of '9.00s', '9.57s', '94%', 'watchdog', or any CPU-time/percentage figures anywhere in the thread. The thread's only timing figure is an unrelated 'app suspends after 30 seconds in background' comment from a different poster. The cited URL does not contain or support this number -- classic citation mismatch (the URL does not say what the report claims it says). The underlying number pattern resembles a genuine iOS EXC_RESOURCE/CPU-exception crash-diagnostic format, so it may be a real local observation from elsewhere in the project's own testing, but it is not sourced to the URL given, and I could not independently verify it (WebSearch budget for this session was exhausted before this could be run to ground).

## Dead ends

- Capturing audio in the WebView with getUserMedia and recognizing it natively — MediaStream lives only inside the WebKit content process and no public API exports it to the host app, or injects host audio into the WebView.
- Holding AVAudioSession natively while playing audio in the WebView (or vice versa) — WKWebView ignores the host category and the host setting .playAndRecord interrupts WebView audio; it is all-native or all-webview, no half.
- Streaming raw PCM from a Swift Tauri plugin to JS — the iOS Swift→Rust channel hop is a JSON C-string (`*const c_char` parsed as serde_json::Value), so there is no binary path and every frame would be base64.
- Compositing the character as a native UIView over the WebView — Tauri's `transparent` is desktop-only and tauri#10152 has sat open with no PR since June 2024.
- Running whisper.cpp / sherpa-onnx / a threaded VAD inside the WebView — `crossOriginIsolated === false` and `SharedArrayBuffer === undefined` under `tauri://` on iOS, measured on device, despite COOP/COEP being set.
- On-device ASR or TTS inference while backgrounded — the CPU watchdog kills at 9 s of CPU over 15 s; background is for capture, playback and orchestration only.
- Declaring UIBackgroundModes=[audio] and describing the feature as background listening — that exact framing is a documented 2.5.4 rejection in Apple's own forum thread.
- Pre-warming the microphone on entering voice mode to hide the 690 ms — the orange indicator lights at `engine.start()`, so pre-warming just lights the dot earlier; there is no third option.
- `_registerURLSchemeAsSecure` on WKProcessPool to make `tauri://` a secure context — it is private API (App Store rejection) and unnecessary, since WebKit already treats any scheme with host `localhost` as potentially trustworthy.
- pixi-live2d-display as the character runtime — PixiJS v6, no Cubism 5, last published about four years ago; use untitled-pixi-live2d-engine or pixi-live2d5.
- Driving companion animation or scheduling from setInterval when backgrounded — WebKit aligns hidden-page timer fire times to whole seconds.
- tauri-plugin-audio-recorder / tauri-plugin-mic-recorder as the companion's audio layer — both are file-based (AVAudioRecorder → M4A on iOS), neither streams frames, and both are strictly worse than what `plugins/voice` already does.

## Open questions

- Battery and thermal cost of an always-hot AVAudioEngine plus an animated WebGL character on an iPad: no published measurement found, from Apple or from comparable apps, in either English or Chinese sources. The only hard published number in this space is the 9 s/15 s background CPU watchdog. This needs an on-device measurement run, not more searching.
- Whether WKWebView background microphone capture still follows UIBackgroundModes=[audio] on iOS 18–26. The WebKit engineer statement (bug 226620) and the community confirmation both stop at iOS 17.5.1; the repo's own prior research flags this as its single largest unverified point and it is still unverified. Moot if audio stays native, which is the current shape.
- Whether the existing native AVAudioSession (playAndRecord/voiceChat) will interrupt or duck audio the WebView plays, in the specific case where the companion's TTS goes native but a PDF page or chat card plays something in the page. Not measured in-repo.
- Actual sustained frame rate of a Live2D or three.js character rendered alongside the EmbedPDF/PDFium viewport on an iPad Air/Pro. No benchmark exists publicly for this combination; the repo has PDFium render timings (730 ms for a 200×200 raster) but nothing about a concurrent animation loop.
- Whether WebGPU in WKWebView on iOS 26 shipped as it was described in the June 2025 beta. The Apple engineer statement and the WebKit Safari 26 post both predate release, and the Safari 26.2 notes (2025-12-12) mention WebGPU additions without restating WKWebView availability. Verify with navigator.gpu on a device before designing around it; WebGL2 is the safe floor either way.
- Whether the volatile/final event contract of SpeechAnalyzer survives continuous (non-push-to-talk) listening. Everything measured in-repo is hold-to-talk with a 5-minute backstop; nobody has run the recognizer open-ended, which is what a proactive companion needs.
- Whether a bespoke Tauri iOS plugin adding a sibling UIView over the WKWebView is viable in practice (z-order, hit-testing, rotation, safe area). Precedent exists for reaching into the WKWebView from a plugin (tauri-plugin-ios-webview-insets), but no project was found that composites a view over it.

## Unverifiable
