# Round 3 / 3 — Running a controller-driven pet on the iPad: WebView, plugin and native paths

> Third round, run 2026-09-10. Dimension brief: where a continuously-generating motion controller runs on this iPad app (WebView / Swift plugin / native view), how its output reaches the renderer, what the render costs, what the power costs, and what the existing `plugins/voice` carrier would have to become to stream a per-frame parameter vector instead of 10 Hz level events. Sibling dimensions cover the controller models and the rigs/data; this one covers only the runtime path. Numbers are labelled measured / derived / third-party. Source URLs and fetch dates are on every finding.

---

## Headline

Architecture A — controller and renderer both in the WebView — is the one the numbers favour, and the reason is arithmetic on the IPC rather than anything about rendering: a 1–5M-parameter MLP at 60 Hz is 0.12–0.6 GFLOP/s, which single-threaded wasm SIMD absorbs, while the same controller in the Swift plugin would have to push 60 parameter vectors a second through a path that, read from the Tauri 2.11.5 and wry 0.55.1 sources, is two JSON serialisations plus one JSON parse plus one cross-process `evaluateJavaScript` string eval per event, all on the UIKit main thread. The pet's *inputs* are slow (the microphone level is 9.6–10.0 Hz measured, the TTS envelope is one event per sentence); only its outputs are fast, so keep the fast half on the side that draws. Two round-1 conclusions need correcting: a Tauri iOS plugin **can** put a native view over the WKWebView — `PluginManager.viewController` is a public var in Tauri's own iOS API and wry adds the webview as a subview of exactly that view, and `tauri-plugin-ios-glass-tabbar` ships this pattern — and wry already calls `setOpaque(false)` on the iOS WKWebView whenever a window background colour is configured, so transparency is reachable from `tauri.conf.json` without waiting on tauri#10152. The hard ceiling that stays is the frame rate: `PreferPageRenderingUpdatesNear60FPSEnabled` defaults to `true` on every WebKit platform except visionOS in current WebKit `main`, it is `status: stable` so it is not a Safari-only experimental flag, and there is no public WKWebView API to turn it off — so anything drawn in the page is a 60 Hz element on a 120 Hz iPad, and only a native `CADisplayLink` path buys the other 60.

## Relevance to this repo

Everything the pet needs to be driven already exists and mostly already streams. `plugins/voice` sends `{kind:"level",value}` at a measured 9.6–10.0 Hz (pitfall 161), `src/ui/components/orb/orb.ts` already turns that into scale and glow with a dt-aware smoother, and `docs/45` already commits to ref + rAF + CSS custom properties with zero React re-renders — which is precisely the consumer shape a per-frame parameter vector needs, so the WebView half of architecture B costs nothing new. What changes if the controller moves native is the carrier: today one event carries one scalar, and a pose vector needs a new event *name* (not a new `kind` — the dictation reducer's union has no default branch, and `VoicePlugin.emitSpeech` already documents that rule as the reason `speech` is its own name). Three repo constraints bound every option. `crossOriginIsolated` is false under `tauri://` on the real iPad WKWebView despite COOP/COEP being set in `tauri.conf.json`, measured in-repo, so any in-page inference engine gets one thread and no SharedArrayBuffer. The CSP is `default-src 'self'` with `wasm-unsafe-eval`, so an ONNX Runtime Web build must be self-hosted the way `pdfium.wasm` is, and ORT's proxy-worker mode is out because it builds its worker from a `Blob`. And pitfall 219 says iOS WebKit clips `filter: blur()` to the element's own box, which is why the orb's halo is a radial gradient — a pet with a glow inherits that rule. If a native view ever does go over the webview, note that the iPad's system selection callout is already a UIKit bar floating above it (round1-06), so the z-order fight has a precedent and a known loser.

## Findings

### A Tauri v2 iOS plugin can add a native UIView above the WKWebView, because Tauri's own iOS API hands the plugin both the webview and the hosting view controller, and wry parents the webview to that controller's view.

`PluginManager` in `tauri-2.11.5/mobile/ios-api/Sources/Tauri/Tauri.swift` declares `public var viewController: UIViewController?`, set from the `@_cdecl("on_webview_created")` entry point that Rust calls with `(webview: WKWebView, viewController: UIViewController)`. On the wry side, `wry-0.55.1/src/wkwebview/mod.rs` line 705 is `#[cfg(target_os = "ios")] { ns_view.addSubview(&webview); }` — the webview is a plain subview, not the view controller's `view` itself, so `PluginManager.shared.viewController!.view.addSubview(mine)` lands above it and `insertSubview(mine, belowSubview: webview)` lands below it. `Plugin.load(webview: WKWebView)` gives the plugin a direct reference for autoresizing and for reading the frame. There is shipping precedent: `tauri-plugin-ios-glass-tabbar` finds the key window at runtime, adds a `UITabBar` pinned to the bottom over the webview, and triggers `tabSelected` back to JS through the same `trigger()` mechanism `plugins/voice` uses; its own README notes the native bar overlays the webview so the page must reserve bottom padding. This contradicts round1-06's "a native UIView composited over the WebView is not a supported path" — that finding read tauri#10152 (still open, no PR, opened 2024-06-29) as covering the whole question, but #10152 is only about `WebviewWindowBuilder::transparent`, a different knob. What you still own yourself is z-order against the system selection callout, hit-testing, rotation and safe area.

- Source: `/home/xinyuan/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/mobile/ios-api/Sources/Tauri/Tauri.swift`; `/home/xinyuan/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.55.1/src/wkwebview/mod.rs:705`; https://crates.io/crates/tauri-plugin-ios-glass-tabbar
- Date: 2026-09-10 (source read locally); tauri#10152 opened 2024-06-29, still open
- Confidence: high for the API surface, medium for it working end to end (nothing built or run)
- Runs on device: ios-untested

### wry already makes the iOS WKWebView non-opaque when a background colour is configured, so a native layer *underneath* the WebView is reachable from `tauri.conf.json` today.

`wry-0.55.1/src/wkwebview/mod.rs:454`, inside the `#[cfg(target_os = "ios")]` webview-construction block: `if let Some((red, green, blue, alpha)) = attributes.background_color { webview.setOpaque(false); ... webview.setBackgroundColor(Some(&color)); }`. `tauri-runtime-wry-2.11.4/src/lib.rs:4858` plumbs `webview_attributes.background_color` into `with_background_color`, and `tauri-utils-2.9.3/src/config.rs:2183` exposes `background_color` on the window config. So setting a window background colour with alpha 0 in `tauri.conf.json` — which the repo's config does not currently set at all — should reach `setOpaque(false)` on the real iOS webview. The page still has to cooperate: `styles.css` paints an opaque body today, and the whole DOM stack above the transparent hole has to be transparent too. wry's own comment beside the call is a warning, not a promise: "This has to be monitored as it may clash with isOpaque = true. The webview background color may also applied too late so actually not that useful." Treat this as a lead to probe, not a settled capability.

- Source: `/home/xinyuan/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/wry-0.55.1/src/wkwebview/mod.rs:447-471`; `tauri-runtime-wry-2.11.4/src/lib.rs:4858`; `tauri-utils-2.9.3/src/config.rs:2183`
- Date: 2026-09-10 (source read locally)
- Confidence: medium
- Runs on device: ios-untested

### Every plugin event on iOS is a JSON string that crosses the Swift/Rust boundary as a C string, is parsed, re-serialised, formatted into a JavaScript source line and executed with `evaluateJavaScript` — there is no binary or structured path.

Read end to end: `DictationRun.send` → `VoicePlugin.emit` → `DispatchQueue.main.async { trigger("dictation", data:) }` → `Plugin.trigger` → `Channel.send` → `JsonValue.jsonRepresentation()` (serialise #1) → the `sendChannelData` C callback → `tauri-2.11.5/src/plugin/mobile.rs:405 send_channel_data_handler`, which does `serde_json::from_str` (parse) → `Channel::send` → `tauri-2.11.5/src/ipc/channel.rs:156`, which serialises again (#2) and calls `webview.eval(format_raw_js(callback_id, "{ message: <json>, index: N }"))` → `tauri-runtime-wry-2.11.4/src/lib.rs:1854 eval_script` → `send_user_message`, which at line 239 takes a same-thread fast path when already on the main thread (it is, because Swift dispatched on `DispatchQueue.main`) → wry's `eval` at `wkwebview/mod.rs:720`, which is one `evaluateJavaScript_completionHandler` with a nil handler. On the JS side `@tauri-apps/api` `Channel` receives an already-parsed object literal (no `JSON.parse`), reorders by `index`, and calls the listener. So the per-event cost is: two JSON serialisations, one JSON parse, one string format, and one main-thread `evaluateJavaScript` whose source text must be sent to the WebContent process and compiled there. The absence of a binary path is structural — the Swift→Rust hop is typed `*const c_char` parsed as `serde_json::Value` — so a float vector cannot avoid being decimal text.

- Source: local reads of `tauri-2.11.5/mobile/ios-api/Sources/Tauri/{Plugin/Plugin.swift,Channel.swift}`, `tauri-2.11.5/src/plugin/mobile.rs`, `tauri-2.11.5/src/ipc/channel.rs`, `tauri-runtime-wry-2.11.4/src/lib.rs`, `wry-0.55.1/src/wkwebview/mod.rs`, `node_modules/@tauri-apps/api/core.js`
- Date: 2026-09-10
- Confidence: high
- Runs on device: ios-yes (this is the path the shipping level events already take)

### Tauri's channel switches from direct `eval` to an extra `fetch` round trip above 8192 bytes of JSON, which sets the batching ceiling at about 27 frames of a 40-float pose vector.

`tauri-2.11.5/src/ipc/channel.rs:37`: `const MAX_JSON_DIRECT_EXECUTE_THRESHOLD: usize = 8192;` with the in-source justification "8192 byte JSON payload runs roughly 2x faster through eval than through fetch on WebView2 v135" and, for raw bytes, "1024 byte payload runs roughly 30% faster through eval than through fetch on macOS" (`MAX_RAW_DIRECT_EXECUTE_THRESHOLD = 1024`). Above the JSON threshold the payload is parked in `ChannelDataIpcQueue` and the eval'd line instead calls `window.__TAURI_INTERNALS__.invoke('plugin:__TAURI_CHANNEL__|fetch', …).then(runCallback)` — a full extra invoke round trip. Measured locally by serialising representative payloads: a single frame of 40 floats at four decimals is 334 bytes of JSON and a 407-byte script line; 100 floats is 767 bytes and an 840-byte line; ten frames of 40 floats batched into one event with a base timestamp and a frame interval is 3,015 bytes, comfortably on the fast path. Nothing a pose stream would plausibly send crosses 8192 unless the batch runs past roughly 27 frames.

- Source: `/home/xinyuan/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.5/src/ipc/channel.rs:36-39,156-181`; payload sizes measured locally 2026-09-10
- Date: 2026-09-10
- Confidence: high
- Runs on device: n/a (arithmetic on the wire format, not device behaviour)

### `requestAnimationFrame` in WKWebView is held near 60 Hz by a WebKit preference that defaults on everywhere but visionOS, and there is no public API to turn it off — so a page-drawn pet is a 60 Hz element on a 120 Hz iPad.

Fetched from WebKit `main` on 2026-09-10, `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` line 4761: `PreferPageRenderingUpdatesNear60FPSEnabled`, `type: bool`, `status: stable`, `category: dom`, description "Prefer page rendering updates near 60 frames per second rather than using the display's refresh rate", `defaultValue: { "PLATFORM(VISION)": false, default: true }`. Because the status is `stable` and not `internal`, this is a shipped default rather than an experiment, and because it is not surfaced on `WKPreferences` or `WKWebViewConfiguration`, the only runtime toggle is the private `_features` / `_setEnabled:forFeature:` pair — which is exactly what `tauri-plugin-macos-fps` does on macOS, and which is App Store risk on iOS. WebKit's own animation-frame-rate explainer gives the reason: "we measured a significant increase in power usage, and second, we found several examples of web pages that had incorrect behavior when `requestAnimationFrame()` callbacks were fired at a non-60Hz frequency," and notes that accelerated CSS animations already run at 120 Hz on ProMotion via Core Animation while "the rest of the Web page only updates at 60Hz". WebKit bug 272165 (RESOLVED FIXED) shows Safari on iPad Pro reaching 120 fps *once the flag is disabled*, which is a user action in Safari's own feature-flag menu and does not reach WKWebView. Round1-02's conclusion stands, with a sharper cause than "Apple's design": it is one named preference whose default is `true`.

- Source: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml ; https://github.com/WebKit/explainers/tree/main/animation-frame-rate ; https://bugs.webkit.org/show_bug.cgi?id=272165 ; https://github.com/userFRM/tauri-plugin-macos-fps
- Date: 2026-09-10 (yaml fetched); bug 272165 reported 2024-04-04, resolved fixed
- Confidence: high for the preference and its default; medium for "no way to change it in WKWebView without private API"
- Runs on device: ios-untested (not probed on this app's webview)

### WebGPU is available in WKWebView on iPadOS 26, and WebGL2 is the safe floor underneath it.

WebKit's Safari 26.0 features post states "WebGPU has been enabled in Safari Technology Preview for over a year, and is now shipping in Safari 26.0 for macOS, iOS, iPadOS, and visionOS" without qualifying it to Safari-the-browser. The WKWebView question was answered separately by an Apple engineer in Developer Forums thread 770862 (June 2025): feature flags "only impact Safari and not WebKit generally. For WKWebView, the feature will work when it's enabled by default." caniwebview.com, last updated 2026-09-05, lists WKWebView on iOS/iPadOS and macOS as supporting `navigator.gpu`, against Android WebView and WebView2 as not supporting it. The app's deployment target is already `"minimumSystemVersion": "26.0"`, so both are in reach. Still worth one `navigator.gpu` probe on the device before designing around it — the round-1 file flagged the same gap and it has not been closed by anything measured.

- Source: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ ; https://caniwebview.com/features/web-feature-webgpu/ ; https://developer.apple.com/forums/thread/770862
- Date: 2026-09-10 (fetched); caniwebview updated 2026-09-05
- Confidence: medium-high
- Runs on device: ios-untested

### An in-WebView inference engine gets one wasm thread and no SharedArrayBuffer, so wasm SIMD is the whole budget — and that is enough for a 1–5M-parameter MLP.

ONNX Runtime Web's own docs: "Only when the browser supports WebAssembly multi-threading and `crossOriginIsolated` mode is enabled, multi-threading will be enabled"; everything else falls back to single-threaded wasm. The repo measured `crossOriginIsolated === false` and `SharedArrayBuffer === undefined` on the real iPad WKWebView under `tauri://` despite COOP=same-origin and COEP=require-corp being set in `tauri.conf.json`, so ORT Web would run one thread here. Two further ORT constraints bite this repo specifically: the proxy worker "cannot work in a Content Security Policy (CSP) restricted environment. This is because the proxy worker uses `Blob` to create a Web Worker" — and this app's CSP is `default-src 'self'` — and "the proxy worker cannot work with WebGPU EP" anyway. wasm SIMD does not require cross-origin isolation and has been in Safari since 16.4, so it survives. The arithmetic says one thread suffices: a dense MLP costs about 2 FLOP per parameter per inference, so 1M parameters at 60 Hz is 0.12 GFLOP/s and 5M at 60 Hz is 0.6 GFLOP/s, one to a few percent of a single modern Arm core running fp32 SIMD.

- Source: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html ; `docs/pitfall/33-ios-no-cross-origin-isolation-still-renders.md` (repo, measured); `src-tauri/tauri.conf.json`
- Date: 2026-09-10 (ORT docs fetched); repo measurement 2026-06
- Confidence: high for the constraints; the GFLOP/s figures are derived, not measured
- Runs on device: ios-yes (the isolation measurement); ios-untested (the inference)

### WebNN does not exist on Safari, so the browser's own ML API is not an option on this platform.

WebKit's standards position on WebNN is "No signal", with Apple participating in the WebML Working Group without commitment. WebNN appears in none of the WebKit feature posts for Safari 26.0 through 26.6, all of which do enumerate WebGPU, scroll-driven animations, anchor positioning and the rest. So the in-page options are wasm (one thread, SIMD) and WebGPU compute; there is no third.

- Source: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ and the 26.1/26.4/26.5/26.6 posts; https://groups.google.com/a/chromium.org/g/blink-dev/c/5CWKSChYo98
- Date: 2026-09-10
- Confidence: high
- Runs on device: ios-no

### ONNX Runtime Web's WebGPU execution provider has a standing "not supported on iOS" report, so the in-page GPU inference path is the least certain part of architecture A.

microsoft/onnxruntime issue 22776 "[Web] Support iOS devices", opened 2024-11-08, now closed, reports that onnxruntime-web with the WebGPU EP does not work on iOS devices regardless of browser, and links a companion issue about the wasm backend failing to load models on iOS 17 browsers with an out-of-memory error. Both reports predate WebGPU shipping on iOS at all (Safari 26.0, 2025), so they describe a world where `navigator.gpu` was absent. That makes them uninformative about iPadOS 26 rather than reassuring. The wasm EP is the path with no such report against it, and it is also the path the arithmetic above says is sufficient.

- Source: https://github.com/microsoft/onnxruntime/issues/22776
- Date: issue opened 2024-11-08, closed; fetched 2026-09-10
- Confidence: low for the current state; high that it is unverified for iPadOS 26
- Runs on device: ios-untested

### For a native controller, the Apple Neural Engine is the wrong accelerator for a small MLP: its per-dispatch floor is about 190 µs on M1 and roughly 98% of that is dispatch, not compute.

Bryngelson, "Apple Neural Engine: Architecture, Programming, and Performance", arXiv:2606.22283, submitted 2026-06-21, measured live on M1 with a read-only trace: a tiny graph of a 3×3 convolution from 8 channels to 8 with padding 1, then a relu, then a mean, run in a hot loop of about 2000 iterations, "costs about 190 microseconds of wall-clock time. About 98 percent of that is software and firmware dispatch overhead rather than engine compute." The per-call budget breaks down as about 25 µs user-space binding plus host fp16 copies, 16 µs building the firmware request, 2–3 µs doorbell, 130 µs firmware round trip, 10 µs kernel-side completion; `ANE_ProgramSendRequest` alone is about 163 µs entry to return. The paper also measures that fusion makes depth nearly free — a conv-relu stack fused into one program "holds its per-call latency flat near 0.19 ms from one layer to thirty-two" — so a whole MLP is one dispatch, not one per layer. At 60 Hz a 0.19 ms floor is 1.1% of the frame budget, so ANE is *viable*; it is just paying a fixed 190 µs for a network whose compute is tens of microseconds. Measurements are on M1 and M5, not on an iPad's A-series, so treat the exact number as the right order of magnitude rather than the iPad's value.

- Source: https://arxiv.org/abs/2606.22283 (PDF text extracted locally, §2.3 and §9.4)
- Date: paper 2026-06-21; read 2026-09-10
- Confidence: high for the M1 measurement, medium for transfer to an iPad SoC
- Runs on device: ios-untested (measured on Mac silicon)

### The right native home for a per-frame controller is BNNS Graph on the CPU, which Apple built for exactly this shape of workload and gives real-time guarantees Core ML's `predict` does not.

Apple's WWDC24 session 10211 "Support real-time ML inference on the CPU" introduces BNNSGraph as the way to "compile and execute machine learning models on the CPU" with "real-time guarantees such as no runtime memory allocation and single-threaded running for audio or signal processing models," consuming a whole multi-layer graph as one object rather than per-layer calls. That is the same guarantee a per-frame animation controller wants for the same reason an audio callback does: no allocation, no lock, bounded time, called from a tick that must not miss. It also sidesteps the ANE dispatch floor entirely and keeps the model off the main thread, which matters here because pitfall 141 measured that blocking the main thread freezes the screen for as long as the block lasts (90 ms of block, 82–119 ms of frozen scroll), independent of listeners or passive flags.

- Source: https://developer.apple.com/videos/play/wwdc2024/10211/ (session title and framing); summary via https://wwdcnotes.com/documentation/wwdcnotes/wwdc24-10211-support-realtime-ml-inference-on-the-cpu/
- Date: WWDC 2024-06; fetched 2026-09-10
- Confidence: medium (the session's existence and framing are certain; no latency numbers were obtained from primary Apple material)
- Runs on device: ios-untested

### When the app is backgrounded the WebView stops executing JavaScript entirely, but iOS 17+ exposes a public preference for the not-visible case, and wry and Tauri already plumb it.

Apple's position, restated across the Cordova and Apple Developer Forum threads on this: all JS execution stops when the app is backgrounded and resumes on foreground, "by design, for the same reasons any app that is suspended no longer gets to execute code." WebKit's own power post states that when pages become inactive WebKit stops `requestAnimationFrame`, suspends CSS and SVG animations, throttles timers, and on iOS "completely suspends tabs when possible". Separately, `WKPreferences.inactiveSchedulingPolicy` (macOS 14+, iOS 17+, iPadOS 17+) lets the host choose `none`, `throttle` or `suspend` for pages that are not visible; `wry-0.55.1/src/wkwebview/mod.rs:473-498` sets it from `attributes.background_throttling`, and Tauri surfaces that as `backgroundThrottling` on the window config. So Slide Over / a non-frontmost window is tunable; a backgrounded app is not. For a pet this is the right shape anyway: it should not animate when nobody is looking, and the WebKit power post's blunt advice is "Drive CPU usage to zero in idle."

- Source: https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/ (2019-08-27); https://developer.apple.com/forums/thread/64150 ; https://issues.apache.org/jira/browse/CB-10657 ; `wry-0.55.1/src/wkwebview/mod.rs:473-498`; https://developer.apple.com/documentation/webkit/wkpreferences/inactiveschedulingpolicy
- Date: 2026-09-10
- Confidence: high for backgrounded behaviour and the API's existence; low for what iPadOS 26's windowed multitasking counts as "not visible"
- Runs on device: ios-untested

### Nobody has published a power measurement for continuous WebGL plus a small model on an iPad, and the closest analogues say frame rate is the dominant lever.

The honest state: no primary Apple energy figure and no third-party measurement was found for this combination, in either the round-1 pass or this one. What exists is adjacent. Niantic's Peridot, the closest shipped AR pet, drained a fully charged iPhone X to 15% in about 15 minutes of play according to a hands-on review, and Niantic acknowledged battery drain in beta and recommended iPhone 8-and-above class hardware — that is a full AR camera pipeline, so it is an upper bound rather than an analogue. A Unity iOS case study measured 60 fps costing an extra 9 percentage points of battery per hour on an iPhone 3GS and 4 points on an iPhone 4 versus 30 fps; GameBench-adjacent analysis puts 60 fps at close to 100% more GPU and about 30% more CPU than 30 fps for slower-paced games, and Genshin Impact at 60 fps is reported to draw 40–60% more than at 30. Every one of those is a different device class and workload than a 5–20k-triangle blob on an M-series iPad, so the usable conclusion is directional only: halving the frame rate at rest is the single biggest lever, and it is free to implement. Sustained thermal throttling is the other named risk — mobile GPUs under sustained load can fall from 60 fps to far less within tens of seconds — and nothing measured says where an iPad sits for this workload.

- Source: https://www.inverse.com/tech/peridot-review-niantic-virtual-pet-augmented-reality ; https://www.moddb.com/members/gamieon/blogs/unity3d-ios-30-fps-vs-60-fps-a-case-study-in-battery-life ; https://blog.gamebench.net/mobile-game-performance-pitfalls
- Date: fetched 2026-09-10; the Unity case study is old hardware
- Confidence: low
- Runs on device: ios-no

### three.js drives a 30-bone skeleton through a bone texture rather than uniforms on anything modern, so the classic mobile bone ceiling is not the binding constraint — but no published iPad frame-time number for a skinned character was found.

three.js creates `Skeleton.boneTexture` automatically when the bone count exceeds the vertex-uniform limit, and the historical mobile limits — 128 or 256 vertex uniforms, which work out to roughly 27 or 59 bones — are what that fallback exists for. 30 bones sits exactly on the old 128-uniform boundary, which is why the texture path matters and why the answer on an M-series iPad is "fine". Community guidance for mobile WebGL puts the draw-call budget under 50 and calls 50k–100k triangles reasonable for a hero object, so a 5–20k-triangle pet in one or two draw calls is far inside the envelope. What does not exist in anything found: a published GPU-time, CPU-time or memory figure for a skinned character in WKWebView on an iPad. The repo's own adjacent number is that PDFium renders a page in 730 ms in the real iPad WKWebView, which says nothing about a steady animation loop beside it. This has to be measured.

- Source: https://threejs.org/docs/pages/Skeleton.html ; https://discourse.threejs.org/t/cpu-skinning-fallback/10435 ; https://threejsroadmap.com/blog/draw-calls-the-silent-killer
- Date: 2026-09-10
- Confidence: medium for the bone-texture mechanics, low for the budgets
- Runs on device: ios-no

### If the pet ever does go native, Rive already has a Metal-backed iOS runtime, which makes architecture C an integration job rather than a renderer-writing job.

`rive-app/rive-ios` ships `RiveRuntime` as a universal `.xcframework` over SPM and CocoaPods, bridging Swift/Objective-C to the C++ engine with a Metal PLS renderer and a CoreGraphics CPU fallback, supporting UIKit, AppKit and SwiftUI, iOS 14+. Since `docs/45` already chose Rive over Live2D for the eventual character, the native path does not force a second art pipeline: the same `.riv` drives either the `@rive-app/webgl2` runtime in the page or `RiveRuntime` in a native view. What architecture C buys over A is the 120 Hz that `PreferPageRenderingUpdatesNear60FPSEnabled` denies the page, plus a `CADisplayLink` whose `preferredFrameRateRange` can be dialled down at rest. What it costs is the z-order, hit-testing, rotation and safe-area ownership from the first finding, plus a second rendering stack to keep alive.

- Source: https://github.com/rive-app/rive-ios ; https://rive.app/docs/runtimes/ios-macos/ios-macos ; https://swiftpackageindex.com/rive-app/rive-ios
- Date: 2026-09-10
- Confidence: medium-high
- Runs on device: ios-untested

### Carrying a pose vector on the existing plugin means a new event name, a batch-plus-timestamp payload, and a consumer that reuses the orb's existing dt-aware smoother — not a new bridge.

From the code: `VoicePlugin.emitSpeech`'s comment states the rule outright — the dictation reducer's union "has no default branch (src/ai/voice/dictation.ts)", so a fifth `kind` on `dictation` breaks it, while "a second name costs nothing on either side — Swift's `trigger` fans out by name and the listener registry is keyed by the name the webview passed". So a pose stream is a third event name beside `dictation`, `speech` and `conversation`. Shape it as `{t0, dt, frames: [[…]]}`: one event carrying N frames with a base timestamp and an interval, replayed against the local clock, exactly the way `docs/45` already specifies for the v2 TTS RMS envelope ("随句子开始一次性发过去，TS 侧按本地时钟回放"). The consumer needs no new machinery — `smoothLevel` in `src/ui/components/orb/orb.ts` already applies its per-frame constant over an arbitrary gap via `1 - (1-k)^(dt/FRAME_MS)`, which is the interpolation a batched stream needs, and `docs/45` already forbids React state on this path: "走 ref + rAF 写 CSS 自定义属性，一次 re-render 都不要". Pitfall 160 is the standing warning about the opposite: volatile results arriving six-per-millisecond, each one "一次 IPC 加一次整棵重渲染", fixed by throttling emission rather than by making the consumer faster.

- Source: `plugins/voice/ios/Sources/VoicePlugin.swift:596-611`; `src/ui/components/orb/orb.ts`; `docs/45-陪伴的形态.md`; `docs/pitfall/160-volatile-results-arrive-in-bursts.md`
- Date: 2026-09-10
- Confidence: high
- Runs on device: ios-yes (the carrier is the shipping one)

### The plugin's emission runs on `DispatchQueue.main`, so a 60 Hz pose stream competes with UIKit and Core Animation on the one thread that must not block.

`VoicePlugin.emit` wraps every `trigger` in `DispatchQueue.main.async`, and the comment gives the reason: "The listener table inside Tauri's Plugin is a plain dictionary written by registerListener on the IPC queue and read by trigger; funnelling every emission through one queue keeps the reads serialised among themselves." That serialisation requirement is real, but it means a per-frame stream puts 60 JSON-serialise-plus-eval jobs per second on the main queue. Because `send_user_message` takes its same-thread fast path when already on the main thread, there is no extra event-loop hop — the `evaluateJavaScript` happens inline in that main-queue block. Pitfall 141 is the standing measurement of what main-thread occupancy does here: 90 ms of block froze the screen for 82–119 ms. Nothing suggests one small eval per frame approaches that, but the budget is shared with the reader, the compositor and the audio graph's own main-thread work, and it is the argument for batching several frames per event rather than one event per frame.

- Source: `plugins/voice/ios/Sources/VoicePlugin.swift:561-569`; `tauri-runtime-wry-2.11.4/src/lib.rs:235-255`; `docs/pitfall/141-a-blocked-main-thread-stops-the-scroll-outright.md`
- Date: 2026-09-10
- Confidence: high for the mechanism, unmeasured for the cost
- Runs on device: ios-untested (cost not measured)

## Numbers

### `PreferPageRenderingUpdatesNear60FPSEnabled` default in current WebKit `main`

- Value: `true` on every platform except `PLATFORM(VISION)`, where it is `false`; `status: stable`, `category: dom`
- Source: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml (line 4761, fetched 2026-09-10)

### Tauri channel JSON payload size above which an extra fetch round trip is added

- Value: 8192 bytes (`MAX_JSON_DIRECT_EXECUTE_THRESHOLD`); raw-bytes equivalent is 1024 (`MAX_RAW_DIRECT_EXECUTE_THRESHOLD`)
- Source: `tauri-2.11.5/src/ipc/channel.rs:36-39`

### Serialised size of one pose event on the wire (measured locally, four-decimal floats)

- Value: 20 floats → 186 B JSON / 259 B script line; 40 floats → 334 B / 407 B; 100 floats → 767 B / 840 B
- Source: measured locally 2026-09-10 with `json.dumps(separators=(',',':'))` plus Tauri's `runCallback` wrapper text

### Batched pose event size, 40 floats per frame

- Value: 2 frames 643 B, 4 frames 1,243 B, 8 frames 2,413 B, 10 frames 3,015 B; the 8192-byte fast-path ceiling lands near 27 frames
- Source: measured locally 2026-09-10

### JSON round trips per plugin event on iOS

- Value: 2 serialisations (Swift `JsonValue.jsonRepresentation`, Rust `Channel::send`), 1 parse (Rust `serde_json::from_str`), 1 `evaluateJavaScript` string eval; 0 `JSON.parse` on the JS side
- Source: local read of `tauri-2.11.5/mobile/ios-api/Sources/Tauri/Channel.swift`, `tauri-2.11.5/src/plugin/mobile.rs:405`, `tauri-2.11.5/src/ipc/channel.rs:156`, `node_modules/@tauri-apps/api/core.js:74`

### Compute of a dense MLP controller at frame rate (derived, 2 FLOP per parameter per inference)

- Value: 1M params → 0.06 GFLOP/s at 30 Hz, 0.12 at 60 Hz; 5M params → 0.30 at 30 Hz, 0.60 at 60 Hz
- Source: derived 2026-09-10; not measured on device

### Apple Neural Engine per-dispatch floor for a tiny graph (M1, ~2000-iteration hot loop)

- Value: about 190 µs wall clock, about 98% of it dispatch overhead; `ANE_ProgramSendRequest` about 163 µs; firmware round trip about 130 µs
- Source: https://arxiv.org/abs/2606.22283 §2.3 (Bryngelson, 2026-06-21)

### Apple Neural Engine cost of depth once fused into one program (M1)

- Value: flat near 0.19 ms from 1 to 32 layers; per-operation cost falls from about 222 µs at one layer to about 6.3 µs at thirty-two
- Source: https://arxiv.org/abs/2606.22283 §9.4

### `evaluateJavaScript` round-trip latency in WKWebView

- Value: about 5 ms on an iPhone 5c on iOS 8 beta 5, with the cost attributed to JSContext construction while parsing the return value; iOS 9 beta 4 began reusing JSContext instances across calls
- Source: https://blog.persistent.info/2015/01/wkwebview-communication-latency.html and https://blog.persistent.info/2015/08/wkwebview-communication-latency.html — eleven years old, includes the return-value path a nil completion handler skips, and should not be used as a current estimate

### three.js bone counts at which the uniform path runs out on mobile GL

- Value: about 27 bones at a 128 vertex-uniform limit, about 59 at 256; above that `Skeleton.boneTexture` is created automatically
- Source: https://discourse.threejs.org/t/cpu-skinning-fallback/10435 ; https://threejs.org/docs/pages/Skeleton.html

### Frame-rate-versus-battery, nearest published analogues

- Value: 60 fps versus 30 fps cost +9 points of battery per hour on iPhone 3GS and +4 on iPhone 4 (Unity case study); ~2× GPU and ~1.3× CPU for slower-paced games (GameBench); +40–60% for Genshin Impact
- Source: https://www.moddb.com/members/gamieon/blogs/unity3d-ios-30-fps-vs-60-fps-a-case-study-in-battery-life ; https://blog.gamebench.net/mobile-game-performance-pitfalls — none is an iPad, none is this workload

### Existing level-event rate from `plugins/voice` (repo, measured)

- Value: 9.6–10.0 Hz over twelve holds; the 15 Hz throttle in `DictationRun.levelInterval` has never fired because the tap buffer arrives slower than the threshold
- Source: `docs/pitfall/161-the-tap-buffer-decides-the-level-rate.md`; `plugins/voice/ios/Sources/DictationRun.swift:252`

## Rejected

- **Architecture B as the default shape** — moving the controller into the Swift plugin buys nothing the controller needs and costs 60 main-thread JSON-plus-eval jobs a second, because the pet's *inputs* are the slow half (10 Hz level, per-sentence envelope) and only its outputs are fast. B is worth it only if the controller must consume native audio or motion at frame rate, which no design on the table requires.
- **Sending one event per frame** — the batching ceiling is about 27 frames of a 40-float vector before the fast path is lost, so there is no reason to pay the per-event cost 60 times a second when 6 to 15 times a second with client-side replay produces the same picture. This is the same trade `docs/45` already made for the TTS envelope.
- **A binary or shared-memory path for pose data** — the Swift→Rust hop is typed `*const c_char` and parsed as `serde_json::Value`, and `crossOriginIsolated` is false under `tauri://` so there is no SharedArrayBuffer either. Decimal text is the only wire format.
- **Multi-threaded wasm or an ORT proxy worker in the page** — no cross-origin isolation (measured in-repo) kills the threads; the CSP's `default-src 'self'` kills the `Blob`-built proxy worker; and the proxy worker cannot combine with the WebGPU EP regardless.
- **WebNN** — WebKit's standards position is "No signal" and it appears in none of the Safari 26.x feature posts.
- **The Apple Neural Engine for a per-frame MLP** — not because it is too slow (0.19 ms is 1.1% of a 60 Hz frame) but because roughly 98% of that is dispatch for a network whose compute is tens of microseconds, and BNNS Graph on the CPU gives real-time guarantees the ANE path does not.
- **Chasing 120 Hz inside the WebView** — the only lever is the private `_setEnabled:forFeature:` on a preference WebKit ships as `true`, which is App Store risk for a mascot. If 120 Hz is required, that is an argument for the native path, not for private API.
- **Sprite sheets, Lottie, and Unity as a Library** — already rejected in round 1 on decoded texture memory (327 MB for 13 states at 512 px), on the absence of bones and continuous blend inputs, and on 110 MB retained while unloaded. A generated controller makes the Lottie objection worse, not better: there is no way to express a pose driven by a continuous scalar.
- **`filter: blur()` for a glow on the pet** — pitfall 219 measured iOS WebKit clipping the blur to the element's own box, `rounded-full` included; the orb already uses radial gradients for this reason.

## Gaps

- **No measured `evaluateJavaScript` cost on a current iPad.** The only published figure is eleven years old, from an iPhone 5c, and includes a return-value path a nil completion handler skips. The whole IPC-cost argument for architecture A rests on a mechanism description, not a number. One probe — a plugin command that fires N no-op events and times the main-queue block — settles it, and it is worth running before anyone builds B.
- **No `navigator.gpu` probe on this app's WKWebView.** WebKit's post, Apple's forum answer and caniwebview all point the same way, and nobody has typed it into the app's own console on the device. WebGL2 is the safe floor either way.
- **No frame-time or memory number for a skinned character in WKWebView on an iPad.** Nothing published was found for the combination, and the repo's own PDFium timings say nothing about a concurrent animation loop. This has to be measured, and it should be measured with the reader open beside it, because that is the real scene.
- **No power measurement for this workload, on any device.** Round 1 recorded the same gap and it is unchanged. Every analogue found is a different device class and a different renderer. The idle strategy (drop to 15–24 fps at rest, stop when not visible) is defensible on WebKit's own guidance without a number, but the cost of the running case is unknown.
- **What iPadOS 26's windowed multitasking counts as "not visible".** `WKPreferences.inactiveSchedulingPolicy` is public and already plumbed by wry and Tauri, but iPadOS 26 replaced Split View and Slide Over with a windowing model and no source found says which windows WebKit treats as inactive. This decides whether the pet keeps animating in a side-by-side layout.
- **Whether `setOpaque(false)` via Tauri's window `backgroundColor` actually produces a transparent WKWebView on iOS.** The code path is unambiguous; wry's own comment beside it warns that the background colour "may also applied too late so actually not that useful". Untested here.
- **Whether a native view added by a plugin survives rotation, safe-area changes and the system selection callout on an iPad.** `tauri-plugin-ios-glass-tabbar` is precedent for a bottom bar, not for a free-floating character that must not eat touches meant for the reader.
- **BNNS Graph latency numbers.** The session's framing was obtained; no Apple-published per-inference figure for a small MLP was found, and the WWDC transcript itself was not retrieved.
- **ORT Web on iPadOS 26.** The one iOS issue found is from 2024 and predates WebGPU existing on the platform, so the current state of both the wasm and WebGPU execution providers on this OS is simply unknown.
