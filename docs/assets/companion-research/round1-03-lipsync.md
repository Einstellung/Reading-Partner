# Round 1 / 3 — 口型同步：自绘角色与生成式说话人视频

> 第一轮调研，2026-08-26 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度原题：Face-matches-voice: viseme lipsync for an authored 2D character (Track 1) vs. generative talking-head video (Track 2)

---

## Headline

Real phoneme-level lipsync stopped being an Azure exclusive — Cartesia's streaming TTS now returns `add_phoneme_timestamps` at ~40–90 ms TTFA — while every shipping generative-avatar API in 2026 renders photoreal human faces server-side at 2–5 Mbps and $0.10–0.37/min, which is 2–37× the cost of TTS alone and structurally unable to draw a glowing non-human sprite.

## Relevance to this repo

The build is authored animation plus viseme lipsync, and the cheapest honest version of it costs almost nothing to adopt: Rive's WebGL2 runtime is MIT, self-hostable, 2.4 MB of wasm+js, and its 2025 Vector Feathering renders the concept sheet's glow as real vector soft-light instead of a texture fake — its state machines take the 8 emotion states, 5 idles and the energy bar as typed inputs, which is work you must do regardless of how the mouth moves. Drop wawa-lipsync (125 KB, MIT, 15 visemes from 7 FFT bands, language-agnostic so it works on Mandarin) on top and you have a talking character with zero recurring cost and zero new vendor; its one real weakness is bilabial closure, so P/B/M will not read. Upgrading that to true visemes is a swap, not a rebuild: Cartesia's `add_phoneme_timestamps` or Azure's `visemeReceived` (zh-CN supported, $15/1M chars ≈ $0.004/min of Mandarin) both hand you a timed schedule you feed to the same Rive inputs, and Apple's `AVSpeechSynthesisMarker.Mark.phoneme` gives the same thing fully on-device for free if a small Swift Tauri plugin is acceptable. Two things in this repo block that path today and both are cheap to fix: the CSP `connect-src 'self' ipc:` will refuse a direct vendor WebSocket, so either widen it or proxy the stream through the existing Rust http plugin; and Tauri v2 exposes neither wry's `autoplay` flag nor any config key for it, so a proactively-speaking character needs an AudioContext unlocked by a first user gesture and kept alive for the session. Budget the sync work against ITU's 45 ms lead / 125 ms lag threshold — schedule visuals off the same AudioContext clock as the audio and you are inside it by construction. The one paid shortcut worth pricing is Mascotbot at $49/mo: it is this exact architecture (Rive + a licensed ML viseme model running locally in the browser, one viseme per 10 ms) already productized, and it would mostly buy you the bilabial accuracy that the free heuristic misses. Note that Live2D is the weaker fit here despite the mature ecosystem — its MotionSync viseme plugin for Web is real and royalty-free, but the engine Core is a proprietary binary you cannot vendor from npm, and a glowing sprite is a worse match for textured mesh deformation than for feathered vectors.

## Findings

### Cartesia's TTS WebSocket returns both word AND phoneme timestamps as first-class stream messages, making it the 2026 cheap/fast equivalent of Azure visemes.


The API reference documents request booleans `add_timestamps` and `add_phoneme_timestamps`. The former yields a `timestamps` message with `word_timestamps.words[]`, `.start[]`, `.end[]` (seconds); the latter yields a `phoneme_timestamps` message with `phoneme_timestamps.phonemes[]`, `.start[]`, `.end[]`. Both must use the same value for every generation request in a context. Cartesia advertises 40 ms time-to-first-audio and sub-90 ms latency for Sonic; MarkTechPost reported Sonic-3.6 shipping 2026-08-18. Pricing works out to ~$59/1M characters on the $39/mo Startup tier (~1,667 min) and ~$9/1M chars on the $239/mo Scale tier; commercial use requires Pro ($4/mo) or above. The docs pages carry no publication date; read 2026-08-26.

- Source: https://docs.cartesia.ai/api-reference/tts/tts
- Date: 2026-08-26
- Confidence: high
- Runs on device: server-only

### Azure Speech is still the most complete viseme source and it covers zh-CN with both viseme IDs and 55-channel blendshapes, at $15 per 1M characters.


22 viseme IDs mapped to IPA phonemes, plus a 55-position blendshape array per frame at a fixed 60 FPS (the ARKit 52 plus headRoll, leftEyeRoll, rightEyeRoll); SVG mouth output exists but only for en-US. The locale table lists zh-CN (Mandarin, Simplified) as "Viseme ID + Blend shapes"; ja-JP and zh-HK get viseme ID only. Delivered via the `visemeReceived` event, which the JavaScript SDK exposes in-browser; blendshapes require the `mstts:viseme` SSML element. Azure's own retail price API returns meter "S1 Neural Text To Speech Characters", unit 1M, retailPrice $15.00 USD, with 0.5M chars/month free. A Microsoft Q&A thread confirms blendshape frames arrive in separate events with audio_offset=0 following the viseme events, which you must buffer and align yourself.

- Source: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
- Date: 2026-02-25
- Confidence: high
- Runs on device: server-only

### Apple's on-device TTS has emitted phoneme markers since iOS 16 — `AVSpeechSynthesisMarker.Mark.phoneme` — via `write(_:toBufferCallback:toMarkerCallback:)`, at zero marginal cost and zero network.


The enum has five cases (word, sentence, paragraph, phoneme, bookmark), all iOS 16.0+ / iPadOS 16.0+ / macOS 13.0+. The writer variant hands you synthesized audio buffers and the marker stream together, so you get audio + phoneme timings before playback and can schedule both. This is the only fully on-device phoneme source I found for iOS. The project already targets iOS 26 minimum, so availability is not a constraint. Cost: a small Tauri Swift plugin to bridge markers + PCM into the WebView. Caveat: no published quality comparison of Apple's zh-CN voices against MiniMax/Volcano, and Apple's Chinese voices are widely considered weaker than the Chinese cloud vendors — no source found either way.

- Source: https://developer.apple.com/documentation/avfaudio/avspeechsynthesismarker/mark-swift.enum
- Date: 2026-08-26
- Confidence: high
- Runs on device: ios-yes

### ElevenLabs gives character-level timestamps only — no phonemes, no visemes — over both HTTP and WebSocket.


The WebSocket `AudioOutput` message carries `audio`, `alignment`, and `normalizedAlignment`, each alignment holding `chars[]`, `charStartTimesMs[]`, `charDurationsMs[]`. Character timing is enough to drive a text-derived viseme schedule if you do your own grapheme-to-phoneme step, which is tractable for English and ugly for Chinese. Timestamps have existed since 2024-05-14. Pricing is $0.10 per 1,000 characters for v3/Multilingual v2 and $0.05 per 1,000 for Flash v2.5 (~75 ms latency, 32 languages) — flat across all tiers from Starter $6/mo to Business $990/mo. That is 3.3–6.7× Azure's per-character price for strictly less lipsync metadata.

- Source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
- Date: 2026-08-26
- Confidence: high
- Runs on device: server-only

### MiniMax is the strongest Chinese-language TTS with usable timing: `subtitle_type` accepts `word` and `word_streaming`, but word-level is as fine as it gets — no phonemes.


Request params are `subtitle_enable` (default false) and `subtitle_type` ∈ {sentence, word, word_streaming}, the last only in streaming mode; results come back as a `subtitle_file` download link, JSON, millisecond timestamps. Supported on speech-01/02/2.6/2.8 in both hd and turbo. Listed pay-as-you-go pricing is $60/1M characters for speech-2.6-turbo and $100/1M for speech-2.6-hd. For Mandarin at ~250 spoken characters/minute that is ~$0.015/min turbo — cheaper per minute than English because Chinese packs more speech into fewer characters. Volcano Engine / Doubao TTS also advertises timestamp subtitle return, but I could not reach a primary doc page naming the parameter.

- Source: https://platform.minimax.io/docs/api-reference/speech-t2a-http
- Date: 2026-08-26
- Confidence: medium
- Runs on device: server-only

### A pure-DSP viseme classifier that runs inside the WebView is 7.5 KB of JavaScript and needs no TTS cooperation at all — wawa-lipsync, MIT, and I read its compiled source.


It builds an AnalyserNode (fftSize 2048 default), splits the spectrum into 7 bands (50–200, 200–400, 400–800, 800–1500, 1500–2500, 2500–4000 Hz, plus a top band), tracks a 10-frame history, computes volume + spectral centroid + band deltas, and scores the 15 Oculus/Ready-Player-Me viseme names (viseme_sil/PP/FF/TH/DD/kk/CH/SS/nn/RR/aa/E/I/O/U) with a consistency penalty capped at maxVisemeDuration = 100 ms. Package is 125 KB unpacked, zero deps, v0.0.2 published 2025-11-07. Because it is acoustic-only it is language-agnostic — it works on Mandarin audio without change. It exposes `connectAudio(HTMLMediaElement)` and `connectMicrophone()`. The formant-band heuristic is genuinely more than amplitude: it can separate rounded /u/ from open /a/ from fricatives, but it cannot reliably detect bilabial closure (P/B/M), which is the one error viewers notice most.

- Source: https://github.com/wass08/wawa-lipsync/
- Date: 2025-11-07
- Confidence: high
- Runs on device: ios-yes

### Live2D's viseme-grade lipsync IS available for Web — the Cubism MotionSync Plugin for Web hit R2 on 2025-03-27, is royalty-free, and takes an arbitrary audio buffer, not just the microphone.


MotionSync wraps CRI Middleware's CRI LipSync, which Live2D licenses on your behalf: "CRI Lipsync used in the MotionSync Plugin is licensed by Live2D, so the MotionSync Plugin is available royalty-free and does not require the CRIWARE logo." R2 (github release published_at 2025-03-27) separated microphone processing into a voice-buffer interface so you can feed decoded TTS audio, and fixed multi-canvas support. The plugin repo's README lists iOS/iPadOS Safari 18.3.2 in its support matrix. Critical caveat: the MotionSync Core itself is a proprietary binary that is deliberately not on GitHub and must be downloaded under the Live2D Proprietary Software License Agreement — you cannot vendor it from npm, and I could not obtain its file size. Base Cubism SDK for Web (no MotionSync) does volume-only lipsync via `GetRms()` → `ParamMouthOpenY`.

- Source: https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/
- Date: 2025-03-27
- Confidence: high
- Runs on device: ios-yes

### Rive is the better authoring runtime for a glowing sprite specifically, and its web runtime is MIT with a 2.0 MB wasm; the only money is editor seats.


`@rive-app/webgl2` v2.40.1: rive.wasm 2,004,858 bytes, rive.js 413,126 bytes, plus an optional rive_fallback.wasm 2,015,300 bytes; 5.1 MB unpacked total, MIT, zero runtime dependencies. rive-wasm repo was pushed 2026-08-25 — actively maintained. Vector Feathering (shipped early 2025) renders soft glows and shadows directly on vector shapes with no rasterization, which is exactly the concept sheet's glowing blue sprite; Live2D would need a texture-atlas fake for the same effect. State machines with typed inputs map cleanly onto 8 emotion states + 5 idle animations + an energy-bar number input. Pricing is per editor seat: Free $0, Cadet $9/seat/mo (3 seats), Voyager $32/seat/mo, Enterprise $120/seat/mo (gated to $10M+ revenue). No per-MAU or per-app runtime fee is stated anywhere on the pricing page.

- Source: https://github.com/rive-app/rive-wasm
- Date: 2026-08-25
- Confidence: high
- Runs on device: ios-yes

### Mascotbot is a shipping product that is almost exactly this feature — Rive character + a licensed ML viseme model running on-device in the browser — for $49/mo.


Ships a React SDK (MascotProvider, useLipsyncStream, useProcessAudio), a WebGL2 Rive runtime, .riv characters of 50–200 KB, and an ML lipsync model that Mascotbot licenses and delivers into your app to run locally: "no audio round-trip, and no server sits in the audio path." It emits one viseme id per 10 ms frame from a ~15–22 shape set, quotes ~5 ms capture, per-25 ms-window local inference, ~8 ms render at 120 fps, total under 100 ms. Plans: Starter $49/mo for 20 hours of lipsync then $2.99/hour (=$0.0498/min); Launch $99/mo for 1,000 MAU with unlimited lipsync minutes; Growth $299/mo for 5,000 MAU; Scale $999/mo for 25,000 MAU; 20% off annual. Named integrations: ElevenLabs Conversational AI, Gemini Live, OpenAI Realtime. Their own writeup argues the bilabial (P/B/M) closure is the single most noticeable lipsync failure — the exact case pure-FFT approaches miss.

- Source: https://templates.mascot.bot/lip-sync-api-2d-characters
- Date: 2026-05
- Confidence: medium
- Runs on device: ios-yes

### NVIDIA open-sourced Audio2Face-3D on 2025-09-24, and it is useless on iOS: the SDK hard-requires CUDA 12.8+ and TensorRT 10.13+ on Windows or Linux.


Released: SDK, Maya plugin v2.0, UE5 plugin v2.5, training framework v1.0, and two models — Regression v2.2 and Diffusion v3.0. Audio2Face-3D-v3.0 is a HuBERT-based transformer+diffusion model with 1.80×10^8 (180M) parameters, taking 16 kHz float audio and emitting 2D float arrays of skin/tongue/jaw/eyeball motion (not documented as ARKit blendshapes). Model card lists Ampere/Blackwell/Hopper/Lovelace/Pascal/Turing GPUs, Linux and Windows only, TensorRT inference; no CPU, no ONNX, no ARM64, no macOS/iOS build. SDK repo is MIT; the model weights are under the NVIDIA Open Model License (commercial use permitted); the training framework is Apache-2.0. The SDK claims "faster than 60 FPS frame generation" — on an NVIDIA GPU. There is no Audio2Face-3D on-device or web story in 2026.

- Source: https://huggingface.co/nvidia/Audio2Face-3D-v3.0
- Date: 2025-09-24
- Confidence: high
- Runs on device: server-only

### Rhubarb Lip Sync has a WASM port but it is 41.9 MB, batch-only, and stale since 2025-03-24 — it cannot sit in a realtime path.


`rhubarb-lip-sync-wasm` v0.1.8, MIT, unpackedSize 41,934,346 bytes (the PocketSphinx acoustic model dominates), last published 2025-03-24, self-described as beta. API takes a raw PCM buffer and returns mouth shapes A–H plus X (Preston Blair set) with timings — whole-file, no streaming. Upstream Rhubarb offers two recognizers: PocketSphinx (better, English dialogue only) and a language-independent "phonetic" recognizer that finds sounds and syllables at lower precision — the latter is the only Chinese-viable path and it is the weaker one. Useful for pre-baking canned lines shipped with the app; not for live TTS.

- Source: https://github.com/danieloquelis/rhubarb-lip-sync-wasm
- Date: 2025-03-24
- Confidence: high
- Runs on device: ios-yes

### Every realtime generative-avatar API in 2026 streams a photoreal human face from a server GPU over WebRTC at 2–5 Mbps, and none of them advertise stylized or cartoon characters.


Tavus CVI: $0.37/min overage (Growth $0.32/min), Basic free 25 min, Starter $59/mo·100 min, Growth $397/mo·1,250 min; ~600 ms latency, 1080p/24 kHz, "every pixel is generated." Beyond Presence: Free €0/40 min, Starter €49/280 min then €0.175/min, Growth €149/1,490 min then €0.10/min, Scale €349/4,000 min then €0.0875/min; conversational agents burn 100 credits/min vs 50 for video-only. HeyGen interactive avatar ~$0.20/min bundled, ~$0.10/min avatar-only (secondary reporting). Simli claims <300 ms and $10 free credit + 50 min/mo, but publishes no per-minute rate; a July 2026 third-party comparison put it at ~$0.009/min at scale, which I could not confirm and do not trust. A July 2026 mobile comparison puts cloud WebRTC avatar streams at 2.0–5.0 Mbps per active session — roughly 22 MB of data per minute at 3 Mbps. Spatius is the one on-device outlier (~$0.007/min, 10–15 KB/s, 1080p/25 fps via Metal) but it is a native AvatarKit.xcframework rendering photoreal 3D Gaussian Splat humans, not a WebView library and not a cartoon.

- Source: https://www.tavus.io/pricing
- Date: 2026-08-26
- Confidence: high
- Runs on device: server-only

### Open talking-head models all want 12–24 GB of NVIDIA VRAM; the fastest realtime one is MuseTalk at 30 fps on a V100, and none has an iOS path.


MuseTalk 1.5 (released 2025-03-28, MIT, commercial use allowed) hits 30 fps or better on a single Tesla V100 by using a single-step latent inpainting pass instead of a diffusion loop. EchoMimicV3 (AAAI 2026, Ant Group, 1.3B params) needs 12 GB VRAM minimum, 16 GB via ComfyUI; tested on A100/4090D/V100; 5 sampling steps for talking head, 15–25 for body. LivePortrait benchmarks on an RTX 4090 and its own README says Apple Silicon "maybe 20x slower than RTX 4090" — that is macOS, not iOS, and 20× slower than realtime is not realtime. For batch generation, ByteDance OmniHuman 1.5 on fal is $0.16 per second = $9.60 per minute of output video.

- Source: https://github.com/antgroup/echomimic_v3
- Date: 2025-07
- Confidence: high
- Runs on device: server-only

### This repo's own CSP and Tauri's config block the two things a voice companion needs: direct vendor WebSockets, and audio that starts without a tap.


src-tauri/tauri.conf.json sets `connect-src 'self' ipc: http://ipc.localhost` — a Cartesia/Azure/ElevenLabs WebSocket opened from the WebView is refused today; either extend connect-src or proxy the stream through Rust (the app already carries @tauri-apps/plugin-http). It also sets COOP same-origin + COEP require-corp, so any externally loaded asset needs CORP headers — self-host every runtime binary. Separately, wry supports `mediaTypesRequiringUserActionForPlayback = None` behind an `autoplay` attribute, but Tauri v2 exposes it neither in WindowConfig (I enumerated the schema at schema.tauri.app/config/2 — no autoplay key) nor on the Rust WebviewBuilder (docs.rs lists no autoplay method). A proactively-speaking character therefore needs an AudioContext unlocked by a user gesture and kept alive, or a patched wry. iOS minimum is already 26.0, so no Apple API in this report is version-gated.

- Source: https://github.com/tauri-apps/wry/blob/dev/src/wkwebview/mod.rs
- Date: 2026-08-26
- Confidence: high
- Runs on device: ios-no

### You have a 45 ms / 125 ms error budget, which is why a cheap approach can look fine and a server round-trip cannot.


ITU-R BT.1359-1 puts the expert-viewer detectability threshold at 45 ms of audio lead to 125 ms of audio lag; ATSC broadcast practice tightens this to 15 ms lead / 45 ms lag, and cinema uses ±22 ms. Mouth-ahead-of-sound is caught nearly 3× more easily than mouth-behind-sound, so when you have to choose, delay the visual, never the audio. A local FFT analyser reading the same buffer that is playing sits at ~0 ms error by construction; a server-derived viseme schedule is fine too because it arrives with the audio and you schedule both off the same AudioContext clock. What does not fit the budget is any design where visual frames traverse the network independently of the audio.

- Source: https://en.wikipedia.org/wiki/Audio-to-video_synchronization
- Date: 2026-08-26
- Confidence: medium

## Numbers

### Azure Neural TTS pay-as-you-go, from Azure's own retail price API (meter "S1 Neural Text To Speech Characters")

- Value: $15.00 per 1M characters, unit 1M, USD; 0.5M chars/month free
- Source: https://prices.azure.com/api/retail/prices?$filter=contains(productName,%20'Speech')

### Azure viseme output granularity

- Value: 22 viseme IDs; 55 blendshape channels per frame at fixed 60 FPS; SVG only for en-US; zh-CN gets viseme ID + blendshapes
- Source: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme

### Cartesia Sonic streaming latency and TTS price

- Value: 40 ms time-to-first-audio / sub-90 ms; ~$59 per 1M chars at Startup $39/mo (~1,667 min), ~$9 per 1M chars at Scale $239/mo (~10,667 min)
- Source: https://cartesia.ai/pricing

### ElevenLabs per-character price

- Value: $0.10 per 1,000 chars (v3 / Multilingual v2); $0.05 per 1,000 chars (Flash v2.5, ~75 ms latency)
- Source: https://elevenlabs.io/pricing/api

### MiniMax TTS price (Chinese-strong)

- Value: speech-2.6-turbo $60 per 1M chars; speech-2.6-hd $100 per 1M chars
- Source: https://minimax-ai.chat/pricing/

### Rive web runtime download weight

- Value: rive.wasm 2,004,858 B + rive.js 413,126 B (5.1 MB unpacked pkg incl. 2.0 MB fallback wasm), @rive-app/webgl2 v2.40.1, MIT, 0 deps
- Source: https://registry.npmjs.org/@rive-app/webgl2/latest

### wawa-lipsync footprint and output

- Value: 125,294 B unpacked; 7,481 B ES module; 15 Oculus viseme names; 7 FFT bands; maxVisemeDuration 100 ms; MIT; v0.0.2 2025-11-07
- Source: https://www.npmjs.com/package/wawa-lipsync

### Rhubarb WASM port weight

- Value: 41,934,346 B unpacked (41.9 MB), v0.1.8, last published 2025-03-24, batch only
- Source: https://www.npmjs.com/package/rhubarb-lip-sync-wasm

### Mascotbot (Rive + on-device viseme model) price and timing

- Value: $49/mo for 20 h then $2.99/h ($0.0498/min); or $99/mo for 1,000 MAU unlimited minutes; 1 viseme per 10 ms frame; 120 fps; <10 ms
- Source: https://www.mascot.bot/

### Tavus CVI realtime avatar price and latency

- Value: $0.37/min overage ($0.32 on Growth); Starter $59/mo·100 min; Growth $397/mo·1,250 min; ~600 ms; 1080p
- Source: https://www.tavus.io/pricing

### Beyond Presence realtime avatar price

- Value: Starter €49/280 min then €0.175/min; Growth €149/1,490 min then €0.10/min; Scale €349/4,000 min then €0.0875/min
- Source: https://www.beyondpresence.ai/pricing

### Cloud avatar WebRTC bandwidth vs on-device animation data

- Value: 2.0–5.0 Mbps per active stream (~22 MB/min at 3 Mbps) vs ~10–15 KB/s for streamed animation params
- Source: https://www.spatius.ai/blog/best-ai-avatar-apis-mobile-apps-2026/

### ByteDance OmniHuman 1.5 batch generation price

- Value: $0.16 per second = $9.60 per minute of output video
- Source: https://fal.ai/models/fal-ai/bytedance/omnihuman/v1.5

### Audio2Face-3D-v3.0 model and hardware

- Value: 180M params (HuBERT transformer+diffusion); CUDA ≥12.8 <13.0, TensorRT ≥10.13; Windows/Linux only; released 2025-09-24
- Source: https://huggingface.co/nvidia/Audio2Face-3D-v3.0

### Open realtime talking-head GPU floor

- Value: MuseTalk 1.5: 30 fps on one Tesla V100, MIT. EchoMimicV3: 12 GB VRAM min, 16 GB via ComfyUI, 1.3B params
- Source: https://github.com/antgroup/echomimic_v3

### Lip-sync error budget (ITU-R BT.1359-1)

- Value: detectable at 45 ms audio lead / 125 ms audio lag; ATSC broadcast practice 15 ms lead / 45 ms lag
- Source: https://en.wikipedia.org/wiki/Audio-to-video_synchronization

## Fact-check

### [1] Both add_timestamps and add_phoneme_timestamps 'must use the same value for every generation request in a context' (like model_id/voice/output_format/language)

- Verdict: **refuted**

Correction: Timestamp flags can be freely toggled per generation request within a context; only model_id/voice/output_format/language must stay fixed.

Evidence: https://docs.cartesia.ai/api-reference/tts/tts — the docs explicitly distinguish these two params from model_id/voice/output_format/language: they are NOT required to stay consistent across a context and can be toggled per-request.

### [1]/[N3] Cartesia advertises 40ms time-to-first-audio and sub-90ms latency for Sonic

- Verdict: **corrected**

Correction: Only 'sub-90ms latency' is a corroborated public Cartesia claim; '40ms time-to-first-audio' could not be found on any current Cartesia source and appears to be unsupported/possibly stale.

Evidence: https://cartesia.ai/sonic states only 'sub-90ms latency' (confirmed) and 40+ languages; https://cartesia.ai/blog/sonic states '135ms model latency' and a relative '1.5x lower time-to-first-audio' claim, not an absolute 40ms figure. docs.cartesia.ai marketing/announcement pages now redirect to a login wall (play.cartesia.ai/docs-auth-login) so could not be checked directly. No public Cartesia page found stating 40ms.

### [1]/[N3] Cartesia pricing ~$59/1M chars on $39/mo Startup (~1,667 min), ~$9/1M chars on $239/mo Scale (~10,667 min); commercial use requires Pro ($4/mo)+

- Verdict: **corrected**

Correction: The $59/1M-char and $9/1M-char figures are the report's own derived conversion from Cartesia's minutes-based pricing (assuming a chars-per-minute rate), not numbers Cartesia itself publishes — the underlying minute/price tiers are correct but the per-character framing is an estimate, not a quoted price.

Evidence: https://cartesia.ai/pricing confirms Free $0, Pro $4/mo ('commercial use license'), Startup $39/mo ~1,667 TTS min, Scale $239/mo ~10,667 TTS min — matches the report. But Cartesia bills TTS by minutes, not characters; it states no per-character rate.

### [N9] Mascotbot: $49/mo for 20h then $2.99/h; or $99/mo for 1,000 MAU unlimited minutes; 120fps; <10ms latency; 1 viseme per 10ms frame

- Verdict: **corrected**

Correction: The $99/1,000-MAU tier is not simply flat/unlimited beyond that — Mascotbot's own page lists a ~$0.12 per-additional-user overage past 1,000 MAU.

Evidence: https://www.mascot.bot/ confirms Starter $49/mo/20h then $2.99/h overage, Launch $99/mo for 1,000 MAU, '120 FPS', '<10MS LATENCY', and separately states 'all production tiers include unlimited lip-sync minutes per active user' (supporting the 'unlimited minutes' framing). However the $99/mo Launch tier also carries a stated ~$0.12/additional-user overage beyond 1,000 MAU that the report's summary omits. The '1 viseme per 10ms frame' granularity claim could not be located (mascot.bot/docs 404'd) and is unverifiable.

### [N10] Tavus CVI: $0.37/min overage ($0.32 Growth); Starter $59/mo·100min; Growth $397/mo·1,250min; ~600ms latency; 1080p

- Verdict: **corrected**

Correction: Pricing and resolution figures are confirmed; the specific '~600ms' latency number is not stated on Tavus's own pricing or CVI-overview docs and could not be corroborated from a primary Tavus source in this session.

Evidence: https://www.tavus.io/pricing confirms Starter $59/mo/100min/$0.37 overage, Growth $397/mo/1,250min/$0.32 overage, and 1080p resolution — all exact matches. But neither tavus.io/pricing nor https://docs.tavus.io/sections/conversational-video-interface/cvi-overview state an explicit ~600ms latency figure; both only use qualitative language ('ultra-low latency', 'world's lowest latency').

## Dead ends

- Generative talking-head video for this character — Tavus, HeyGen, Simli, D-ID, Beyond Presence, Akool all generate photoreal human faces from a reference portrait; none advertises stylized or non-human characters, and a glowing blue sprite is out of distribution for every one of them.
- NVIDIA Audio2Face-3D despite the 2025-09-24 open-sourcing — the SDK requires CUDA 12.8+ and TensorRT 10.13+ on Windows or Linux; no ARM64, macOS, iOS, ONNX, or CPU build exists.
- Running MuseTalk / EchoMimicV3 / LivePortrait / Hallo / SadTalker on the iPad — floor is 12–24 GB of NVIDIA VRAM; LivePortrait's own README puts Apple Silicon at ~20× slower than a 4090.
- Meta's Oculus Lipsync SDK — end-of-life, no further updates; the replacement is audio-based face tracking in the Movement SDK behind the XR_META_face_tracking_visemes OpenXR extension, i.e. Quest-only.
- Bundling Rhubarb's WASM port for live lipsync — 41.9 MB unpacked, whole-file batch API, no streaming, last published 2025-03-24, and its accurate recognizer is English-only.
- ARKit `ARFaceAnchor.blendShapes` as a lipsync source — those 0.0–1.0 coefficients come from the TrueDepth camera reading the user's own face, not from audio; useful only if you want the user to puppeteer the sprite.
- OpenAI's Realtime API as the face driver — its docs describe transcript deltas (`response.output_audio_transcript.delta`) but document no word- or phoneme-level timing on the audio it emits, so you are back to amplitude.
- Spatius's $0.007/min on-device avatar — it is a native AvatarKit.xcframework rendering photoreal 3D Gaussian Splat humans via Metal, not a WebView library, and not a cartoon.
- Duix-Mobile (硅基智能, 8.2k stars, on-device iOS/Android, <120 ms on Snapdragon 8 Gen 2) — genuinely on-device and genuinely open, but it renders 2D photoreal humans and I could not confirm its license from the repo.
- Live2D MotionSync as a vendorable dependency — the plugin is on GitHub but MotionSync Core is deliberately not, and must be downloaded under the Live2D Proprietary Software License Agreement.
- ElevenLabs for lipsync metadata — character timestamps only, at 3.3–6.7× Azure's per-character price.

## Open questions

- Whether Cartesia's `add_phoneme_timestamps` covers Mandarin and which phoneme inventory it emits (IPA? ARPAbet? per-language sets?) — the detail pages behind docs.cartesia.ai redirect to an auth login.
- Actual CPU and battery cost of running Live2D or Rive at 60 fps in an iPad WKWebView — no published measurement found for either runtime on iOS; this needs a device probe, not a search.
- Whether an AudioContext unlocked by one tap at app launch stays unlocked for the whole session in a Tauri WKWebView, which is what proactive speech depends on. Confirmed that Tauri does not expose wry's autoplay flag; found no primary WebKit source on the persistence question.
- The file size and offline behaviour of the Live2D MotionSync Core for Web — it is not on GitHub or npm and requires accepting a license to download.
- Mascotbot's engine internals: model size, whether it works fully offline after load, and what its 15–22 viseme set actually is. Their pricing and timing claims are published; the engine is not.
- Live2D's exact revenue threshold for the small-business exemption — a Live2D forum post says annual sales under 10,000,000 JPY, but the official English license page states only "Individuals and Small-Scale Enterprises are exempted" with no number.
- Azure viseme event latency in streaming synthesis (how far ahead of the audio chunk the viseme events arrive) — undocumented; the Q&A thread confirms blendshape frames come in separate zero-offset events you must buffer yourself.
- Whether Apple's zh-CN AVSpeechSynthesizer voices are good enough for a companion character — no comparison against MiniMax or Volcano Engine exists, and the on-device phoneme-marker advantage is worthless if the voice sounds like a 2015 navigation system.
- Volcano Engine / Doubao TTS timestamp parameter names — the product page advertises "时间戳字幕返回" but docs.volcengine.com returned empty content to every fetch.

## Unverifiable

- [2] zh-CN gets 'Viseme ID + Blend shapes' in the locale table, while ja-JP/zh-HK get viseme ID only
- [2] A Microsoft Q&A thread confirms blendshape frames arrive in separate events with audio_offset=0 following viseme events, requiring manual buffering/alignment
- [5] MiniMax pricing $60/1M chars (speech-2.6-turbo) and $100/1M chars (speech-2.6-hd), cited to the api-reference/speech-t2a-http doc page
- [6] wawa-lipsync compiled ES module is 7.5 KB / cannot reliably detect bilabial closure (P/B/M)
- [7] MotionSync Plugin for Web hit R2 on 2025-03-27, separating mic processing into a voice-buffer interface (so decoded TTS audio can be fed in, not just mic), and the support matrix lists iOS/iPadOS Safari 18.3.2
