# Round 1 / 4 — 实时语音回路

> 第一轮调研，2026-08-26 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度原题：The realtime voice loop (latency target, speech-to-speech vs cascade, VAD/turn-detection/ASR/TTS components, barge-in, frameworks, cost)

---

## Headline

Claude still accepts no audio in either direction as of 2026-08, so a Claude-brained voice companion is structurally a cascade landing around 550-900ms per turn versus ~200ms for a native speech-to-speech model — and the decision that actually matters is not which vendor but whether the ears and mouth run on the iPad (roughly $0.12-0.48/hour) or in the cloud (roughly $0.7-6/hour), because a companion that is present for a whole reading session is billed by the hour.

## Relevance to this repo

The load-bearing fact is that Claude has no ears and no mouth and Anthropic closed the request for them, so Reading-Partner cannot buy a realtime loop — it assembles one, and the assembly is a cascade whose LLM stage is the dominant term. That forces a model split the app does not have yet: the chatty companion voice has to run on Haiku-class latency (300-800ms TTFT) while Opus 5 with adaptive thinking stays on the deep passes, because the observation pipeline's model would put every spoken turn seconds late. Everything else in the loop is cheap and small enough for the iPad — TEN VAD is a 320KB iOS library with a WASM build, Smart Turn v3 is 8MB and 23 languages, and SpeechTranscriber gives free on-device streaming Mandarin including yue_CN — so the realistic first build is a Tauri Swift plugin holding AVAudioEngine + VPIO + SpeechTranscriber, with VAD and turn detection either beside it in Rust or as WASM inside the WebView, and only TTS bought from a vendor. Do not try to run this through `getUserMedia`: WKWebView mutes the mic when the app backgrounds, Tauri v2 has open iOS permission-prompt bugs, and iOS echo cancellation only exists behind AVAudioSession, which is exactly the surface doc 33 already measured. TTS is the one component with no good free answer, because AVSpeechSynthesizer refuses streaming text and therefore forfeits the biggest latency win in the cascade, while the shipped Kokoro Swift package is English-only — so plan on ElevenLabs Flash v2.5 or a Chinese vendor at roughly $0.006 per spoken minute, and treat every published TTFB as excluding network. Budget 150-300ms real TTS first-audio, not 75ms, which puts a careful build at 600-900ms per turn: three to four times the human 208ms, inside the sub-800ms band practitioners call smooth, and about 400ms behind what a native speech-to-speech model does — that gap is the price of keeping Claude as the brain, and it is a fixed, structural price. Two things the concept art implies are already answered: the interruption path requires the client to truncate the assistant turn to what was actually heard (OpenAI documents this as the client's job on WebSocket, and it is the project's own rule in doc 27), and the "thinking" idle animation is not decoration — with tool calls in the loop a page lookup costs seconds, and the filler utterance plus a visible state change is how production agents cover it. Finally, price the feature by the hour, not the call: a companion present through a two-hour reading session costs about $0.25 on the on-device stack and $10 on ElevenLabs Agents, so where the ears and mouth run is the build decision, not which vendor supplies them.

## Findings

### The Claude API accepts no audio input and produces no audio output, and the feature request to add it was closed as not planned in 2026.


The models overview page states flatly: "All current models support text and image input, text output, multilingual capabilities, vision, and tool use." The vision guide's supported-formats list is JPEG/PNG/GIF/WebP only, and its FAQ answers only image questions. The anthropic-sdk-python feature request for an `audio` content block (issue #1198, opened 2026-02-23) is closed as not planned. There is no realtime endpoint, no streaming audio, no TTS. Anything voice-shaped around Claude is something you build or buy from another vendor.

- Source: https://platform.claude.com/docs/en/about-claude/models/overview
- Date: 2026-08
- Confidence: high

### Claude's own voice mode is a consumer-app feature wrapped around a text model, not a capability you can call — and Anthropic explicitly did not improve the voice model or interruption handling in its 2026 update.


TechCrunch (2026-07-23) reports Anthropic let users pick Opus/Sonnet/Haiku inside voice mode and added connectors and ~11 languages, but states "Anthropic didn't make any changes to the voice model with this release" and notes no improvement in interruption handling, unlike OpenAI's recent work. Claude Code's voice dictation streams audio to Anthropic servers for transcription but is gated to claude.ai account auth — explicitly unavailable when using an API key, Bedrock, Vertex, or Foundry. So even the transcription path is not purchasable.

- Source: https://techcrunch.com/2026/07/23/anthropic-updates-claude-voice-mode-with-more-capable-models/
- Date: 2026-07-23
- Confidence: high

### The perceptual target is ~200ms and it is a hard biological number, not a preference: across 10 unrelated languages the modal between-turn gap is 0ms and the mean is +208ms.


Stivers et al., PNAS 2009: "The mean response offset for the full dataset is +208 ms," with each language's mode between 0 and +200ms and an overall mode of 0ms. The spread across languages is Japanese +7ms to Danish +469ms, and all language means sit within ~250ms of the cross-language mean — about the length of one English syllable. Nothing in 2026 revises this; it is the reference every voice-agent latency post cites. Practitioner consensus in 2026 puts the workable ceiling at sub-500ms time-to-first-audio as a minimum target, still smooth to ~800ms, and degrading past ~1200ms.

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/
- Date: 2009-06
- Confidence: high

### A well-tuned 2026 cascade with a Claude model in the middle lands at 550-700ms p50; a cascade left on framework defaults lands at 1200-1400ms p95.


A LiveKit-focused 2026 engineering writeup reports 550-700ms p50 end-to-end for Deepgram Nova-3 streaming STT + Claude Haiku 4.5 + Cartesia Sonic-3, all pinned to one region with short system prompts; the same source puts a vanilla AgentSession at 1.2-1.4s p95 and an optimized one at 500-650ms p95. LiveKit's own architecture post (2026-03-23) gives the per-stage budget: VAD 10-50ms, STT ~200ms for a complete utterance (partials under 100ms), LLM first token 300-800ms, TTS first audio chunk 100-200ms; naive blocking 1000-2000ms+, streamed 400-800ms. The LLM's TTFT dominates, which is why the fast Claude tier matters and why Opus 5 with adaptive thinking always on is not a voice-loop model.

- Source: https://livekit.com/blog/sequential-pipeline-architecture-voice-agents
- Date: 2026-03
- Confidence: medium
- Runs on device: server-only

### OpenAI's Realtime API is GA with gpt-realtime-2.1 at $32/$64 per 1M audio tokens ($10/$20 for mini), and cached audio input collapses to $0.40/$0.30 — caching is the whole cost story.


OpenAI's pricing page lists gpt-realtime-2.1 audio input $32.00/1M, cached audio $0.40/1M, audio output $64.00/1M; gpt-realtime-2.1-mini at $10.00 / $0.30 / $20.00. Text on the flagship is $4/$24, image $5. The realtime guide confirms GA ("remove the OpenAI-Beta header") and three transports: WebRTC for browser and mobile clients, WebSocket for server-side media pipelines, SIP for telephony. Model ids also include gpt-realtime-translate and gpt-live-transcribe. Secondary reporting puts claimed single-turn end-to-end at 190ms for 2.1 and measured ~210-230ms for 2.1-mini, released 2026-07-06 with a claimed 25% p95 latency cut from caching.

- Source: https://developers.openai.com/api/docs/pricing
- Date: 2026-08
- Confidence: high
- Runs on device: server-only

### Gemini Live native audio is cheaper than OpenAI by roughly an order of magnitude at $3/$12 per 1M audio tokens, but every Live model is still Preview on the Gemini Developer API.


Google's pricing page lists gemini-2.5-flash-native-audio-preview-12-2025 at audio input $3.00/1M, audio output $12.00/1M, text $0.50/$2.00, and states billing at "25 tokens per second of audio, equating to an effective price of approximately $0.0368 per minute." gemini-3.1-flash-live-preview is listed as a low-latency audio-to-audio model at comparable rates. At 25 tok/s the arithmetic is $0.0045/min inbound and $0.018/min outbound. The models page marks both as Preview; a claim of Vertex AI GA at Google I/O 2026 comes only from secondary sources.

- Source: https://ai.google.dev/gemini-api/docs/pricing
- Date: 2026-08
- Confidence: high
- Runs on device: server-only

### Semantic turn detection is now small enough to run on the iPad: Pipecat's Smart Turn v3 is an 8MB int8 ONNX model, ~8M params, 12.6ms on a server CPU and 9-57ms across CPUs, BSD-2-clause, covering 23 languages including Chinese.


Daily's v3 announcement (2025-09-11): Whisper Tiny encoder plus a linear classifier, 8MB int8 / 32MB fp32, inference including ~3ms preprocessing at 12.6ms on AWS c7a.2xlarge, 33.8ms on t3.2xlarge, 94.8ms on t3.medium. Per-language accuracy at v3: Chinese 88.57% (4.76% false positive, 6.67% false negative), English 94.31%, Vietnamese 81.27%. v3.1 (2025-12-03) raised English to 94.7% (8MB) / 95.6% (32MB) and Spanish to 90.1%, at 9-57ms CPU; Chinese was not broken out in the v3.1 table. The contrast that matters: this replaces a fixed silence timeout, which spends most of a second before the pipeline even starts.

- Source: https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/
- Date: 2025-09
- Confidence: high
- Runs on device: ios-yes

### LiveKit's turn detector is measurably better than Smart Turn on Chinese but is a 0.5B model needing <500MB RAM — a server component, not an on-device one.


LiveKit's v0.4.1-intl (2025-12-12) is Qwen2.5-0.5B-Instruct fine-tuned and distilled from a Qwen2.5-7B teacher, exported to ONNX and INT8-quantized, running on CPU in a shared process at under 500MB RAM. It reports a 39.23% relative reduction in false-positive interruptions versus v0.3.0-intl; overall error rate 18.66% → 11.34% at a 99.3% true-positive rate, with Chinese specifically 18.70% → 13.40%. 14 languages including Chinese. Open weights on Hugging Face. The 500MB working set rules it out of an iPad process that already holds PDFium WASM and a book.

- Source: https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39
- Date: 2025-12
- Confidence: high
- Runs on device: ios-no

### VAD is a solved, free, tiny problem on every platform including inside the WebView: TEN VAD ships a 320KB iOS arm64 library with RTF 0.0086-0.057 and a WASM build; Silero v6 is 309K params and ~1.2MB.


TEN VAD's model card lists per-platform library sizes — 320KB iOS (arm64, device only), 306KB Linux, 731KB macOS M1, 373/532KB Android — real-time factor 0.0086 (Intel Xeon) to 0.057 (Galaxy J6+), 16kHz input, 10ms/16ms hop, with bindings for C, Python, Go, Java and JavaScript/WASM plus a browser demo. License is Apache 2.0 with additional conditions (bundling modified BSD-2/BSD-3 LPCNet code). TEN's own claim is that Silero lags speech-to-non-speech transitions by several hundred milliseconds, which directly inflates end-of-turn latency; Silero v6 is ~309K params / ~1.2MB with ONNX opset 15 and 16 exports. Either can run in the Tauri WebView via WASM.

- Source: https://huggingface.co/TEN-framework/ten-vad
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Apple's SpeechAnalyzer/SpeechTranscriber is the only free, on-device, streaming Mandarin ASR on iPad, and it covers zh_CN, zh_HK, zh_TW and yue_CN — but it is a native API, unreachable from the WebView.


Shipped in iOS 26 (WWDC25 session 277), on-device only, no duration cap, exposed as three modules: SpeechTranscriber (long-form), DictationTranscriber (short utterances), SpeechDetector (voice activity). One reported migration cut first-word latency from 780ms to 140ms. supportedLocales includes zh_CN, zh_HK, zh_TW and yue_CN among ~42 locales. Apple publishes no WER for Mandarin, so accuracy against the Chinese cloud models is unmeasured. Reaching it from Reading-Partner means a Tauri plugin in Swift, the same shape as the existing desktop cpal path — not `getUserMedia` in the WebView.

- Source: https://developer.apple.com/videos/play/wwdc2025/277/
- Date: 2025-06
- Confidence: medium
- Runs on device: ios-yes

### Whisper is the worst available choice for Mandarin, by 3x: 5.14% CER on AISHELL-1 and 18.87% on WenetSpeech Meeting versus 1.52-1.68% and 4.7-6.5% for the Chinese-native models.


An April 2026 Chinese ASR survey tabulates AISHELL-1 / WenetSpeech-Meeting CER: FireRedASR2-AED 0.57%/4.53%, Doubao-ASR API 1.52%/4.74%, Fun-ASR API 1.64%/5.78%, Paraformer-Large (220M) 1.68%/~6.5%, Whisper large-v3 (1.55B) 5.14%/18.87%. It also notes Whisper has no true streaming (~3.3s+), versus FunASR 2-pass at 480-600ms acoustic latency and Qwen3-ASR at 92ms TTFT. The same source flags a paper-vs-API gap: Seed-ASR's paper reports 0.68% AISHELL-1 while the shipped Doubao API measures 1.52%. This matters because WhisperKit/whisper.cpp is the reflexive on-device answer and is the wrong one for a Chinese-reading user.

- Source: https://ruoqijin.com/blog/asr-deep-dive-2025-2026
- Date: 2026-04
- Confidence: medium
- Runs on device: ios-yes

### Chinese cloud streaming ASR is close to free: Alibaba's fun-asr-realtime is officially ¥0.00033 per second of audio (¥1.19/hour, ~$0.0028/min) and supports large-scale custom hotwords.


Alibaba Model Studio's fun-asr-realtime model page lists the price as 0.00033 yuan per second, with snapshots 2026-02-28, 2025-11-07, 2025-09-15, free Chinese/English switching, multi-dialect coverage, large-scale hotword customization, sensitive-word filtering, Beijing and Singapore regions, 1200 RPM. Cross-vendor streaming prices from the April 2026 survey (CNY/hour): Alibaba Bailian ¥0.288, Volcengine Doubao 2.0 ¥0.90, Tencent ¥1.80, Baidu ¥3.00, versus AssemblyAI English $0.21/hr. Note the ¥0.288/hr figure conflicts with the official ¥1.19/hr for fun-asr-realtime specifically, probably a cheaper Paraformer tier. Hotword support is directly usable for the book-title/outline glossary already built in src/ai/voice/cleanup.ts.

- Source: https://help.aliyun.com/zh/model-studio/fun-asr-realtime
- Date: 2026-08
- Confidence: high
- Runs on device: server-only

### Every published TTS time-to-first-byte number in 2026 is a vendor claim measured without network, and the one independent benchmark firm that wrote a post titled "why vendor benchmarks lie" filled it with vendor numbers.


ElevenLabs' own docs give Flash v2.5 and Turbo v2.5 "~75ms†", v3 Conversational "~280ms", Scribe v2 Realtime "~150ms", with the footnote "†Excluding application & network latency". Deepgram's engineering post claims Aura-2 went from sub-200ms to ~90ms steady-state with p95 90-200ms. Cartesia claims ~90ms Sonic-3 / ~40ms Turbo; Rime sub-100ms; MiniMax speech-2.6 under 250ms end-to-end; Inworld ~180ms; PlayAI ~150ms. Coval's June 2026 comparison reproduces exactly these vendor figures while warning they hide percentile, network, and load, and publishes no p50/p95 of its own in the post. One secondary claim puts ElevenLabs at 255ms median TTFB including network. Budget 150-300ms real, not 75ms.

- Source: https://elevenlabs.io/docs/models
- Date: 2026-08
- Confidence: high
- Runs on device: server-only

### On-device TTS on iPad is real but each option loses something load-bearing: AVSpeechSynthesizer cannot accept streaming text at all, and the shipped Kokoro Swift package is English-only.


AVSpeechSynthesizer is free, offline, and has "super-compact" neural voices that need no network, but it requires the full string before emitting any audio — which destroys the single biggest cascade latency win, starting TTS on the first LLM tokens. It also selects voice by device system language rather than by the language of the text. Kokoro-82M (~82M params, ~80MB int8) runs on the Neural Engine via CoreML at 12-79x realtime across Apple silicon and ~3.3x realtime on an iPhone 13 Pro in an MLX Swift build; the MIT-licensed kokoro-ios package is en-US only and non-streaming. Kokoro-82M-v1.1-zh exists with 100 Chinese speakers but no iOS/CoreML port surfaced. Orpheus (3B/1B/400M/150M) and Sesame CSM-1B (now Apache 2.0) are conversation-quality but 1B+ — not iPad-realtime candidates.

- Source: https://github.com/adriancmurray/kokoro-ios
- Date: unknown
- Confidence: medium
- Runs on device: ios-yes

### Correct barge-in is the client's job, and the exact mechanism the project already specified is what OpenAI documents: on WebSocket you must track playback position and truncate the assistant turn to what was actually heard.


OpenAI's realtime conversation guide states that WebRTC and SIP connections "automatically truncate unplayed audio when there's a user interruption," but on a WebSocket connection the client must track playback position itself and send a `conversation.item.truncate` event carrying `audio_end_ms` to drop the unplayed portion. Turn detection is configured as `server_vad` (threshold 0-1, `prefix_padding_ms`, `silence_duration_ms`) or `semantic_vad` (`eagerness`: low/medium/high/auto, auto == medium), with `null` for push-to-talk; OpenAI publishes no default millisecond values for any of these. Any hand-rolled stack inherits the same obligation — this is doc 27's rule, restated by the vendor.

- Source: https://developers.openai.com/api/docs/guides/realtime-conversations
- Date: 2026-08
- Confidence: high

### Once tool calls enter the loop — which is exactly what a companion that reads the book's pages does — latency jumps from milliseconds to seconds, and the cascade is the slowest of all at 10.12s.


Full-Duplex-Bench v3 (arXiv 2604.04847, 2026-04-06) evaluates six systems on real human audio with five disfluency categories plus chained API calls across four task domains. GPT-Realtime had the best Pass@1 (0.600) and best interruption rate (13.5%); Gemini Live 3.1 was fastest at 4.25s while the cascaded Whisper→GPT-4o→TTS baseline was slowest at 10.12s — though the cascade achieved a perfect turn-taking rate versus Gemini Live 3.1's 78.0%. Self-correction handling and multi-step reasoning were the consistent failure modes across all systems. The practical implication: a companion asked something requiring a page lookup will be seconds late no matter the vendor, and needs a filler utterance or backchannel to cover it.

- Source: https://arxiv.org/abs/2604.04847
- Date: 2026-04
- Confidence: high
- Runs on device: server-only

### ElevenLabs Agents is the shortest path to "Claude's brain, someone else's ears and mouth" — it lists Claude Sonnet 5, Opus 4.8/4.7, Sonnet 4.6/4.5 and Haiku 4.5 as selectable agent LLMs — at $0.08/min plus LLM passthrough.


ElevenLabs' agent LLM docs list Anthropic Claude alongside ElevenLabs-hosted Qwen, Gemini and GPT, with Claude Opus 4.8, Opus 4.7, Sonnet 5, Sonnet 4.6, Sonnet 4.5 and Haiku 4.5 as available model ids; the docs note ElevenLabs-hosted models have the lowest latency and publish no numbers for the others. Pricing is bundled minutes per plan (75 Starter to 12,375 Business) then $0.08/min, with LLM tokens and telephony billed separately. That is roughly $4.80/hour before the LLM — an order of magnitude above a self-assembled stack, and the platform is shaped around phone calls, not an app-embedded companion.

- Source: https://elevenlabs.io/docs/agents-platform/customization/llm
- Date: 2026-08
- Confidence: high
- Runs on device: server-only

### LiveKit is the only framework with a first-class Swift client for iOS/iPadOS, at $0.01/min agent session with 1,000 free minutes a month — but its agent still runs on a server you operate.


LiveKit's pricing page: Build free with 1,000 agent session minutes/month, Ship from $50/mo with 5,000 included then $0.01/min, Scale from $500/mo with 50,000 then $0.01/min. Their own calculator sums a phone voice agent at $0.0672/min (agent session $0.0100, telephony $0.0100, LLM $0.0014, STT $0.0058, TTS $0.0300, observability $0.0100). livekit/client-sdk-swift covers iOS, macOS, tvOS and visionOS, with an agent-starter-swift template doing voice, transcriptions, live video input and virtual avatars. Pipecat has no hosting at all — you run the Python pipeline yourself. Vapi charges $0.05/min orchestration excluding providers; Retell $0.07/min flat; secondary reporting puts real all-in deployments at $0.11-0.33/min.

- Source: https://livekit.com/pricing
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### The WebView is the wrong place to put the audio loop on iOS: WKWebView mutes microphone capture when the app backgrounds, Tauri v2 has open iOS permission-prompt bugs, and the OS echo canceller lives in AVAudioSession where the WebView cannot reach it.


Apple's developer forums document that WKWebView's `microphoneCaptureState` becomes muted shortly after the app enters background, so mic audio stops being sent mid-session. Tauri has multiple open issues on webview media permissions, including one where iOS re-prompts for microphone permission every time the user quits the app, and permissions not being remembered per webview. iOS acoustic echo cancellation comes from setting AVAudioSession mode to `.voiceChat` or enabling `voiceProcessingEnabled` on the audio unit — a native surface. The existing Tauri-plugin pattern (cpal on desktop) extended with AVAudioEngine + VPIO on iOS is the path; `getUserMedia` in the Tauri WebView is not.

- Source: https://developer.apple.com/forums/thread/689182
- Date: unknown
- Confidence: medium
- Runs on device: ios-no

### Per-minute cost across plausible 2026 stacks spans roughly 40x, and the on-device-ears-and-mouth stack is the only one whose economics survive a two-hour reading session.


Assuming the companion speaks about 30s of each conversational minute at a Mandarin rate near 250 chars/min (~125 chars), and a Haiku-class turn at ~6000 cached input + 300 output tokens/min: (A) Apple SpeechTranscriber $0 + Claude Haiku 4.5 $0.002-0.008/min + on-device TTS $0 = $0.12-0.48/hour. (B) fun-asr-realtime $0.0028/min + Haiku $0.002-0.008/min + ElevenLabs Flash v2.5 at $50/1M chars ≈ $0.006/min = $0.011-0.017/min, or $0.66-1.02/hour. (C) Gemini Live native audio, vendor-stated ~$0.0368/min = $2.21/hour, but Claude is out of the loop. (D) OpenAI gpt-realtime-2.1 with caching working, $0.05-0.10/min = $3-6/hour, Claude also out; the mini at $10/$20 is ~1/3 of that. (E) ElevenLabs Agents $0.08/min + Claude passthrough ≈ $5/hour.

- Source: https://developers.openai.com/api/docs/pricing
- Date: 2026-08
- Confidence: medium

### The one CHI 2026 study that found users prefer slower AI responses tested text chat at 2/9/20 seconds, not voice — do not import it into a turn-taking decision.


"The Impact of Response Latency and Task Type on Human-LLM Interaction and Perception" (CHI 2026, arXiv 2604.06183, 2026-02-09) is explicitly text-only. It tested TTFT delays of 2s, 9s and 20s and found 2s responses rated less thoughtful than 9s or 20s, usefulness peaking at 9s (M=6.44 vs 6.19 at 2s), with 27% / 66% / 82% of participants noticing the delay at 2s / 9s / 20s. That is a finding about deliberation signalling in typed conversation. It says nothing about spoken turn-taking, where the 208ms floor is set by conversational timing, not by judgments of thoughtfulness. The transferable half is that a visible or audible "thinking" signal buys tolerance — which is what production agents do with filler utterances and backchannels during tool calls.

- Source: https://arxiv.org/html/2604.06183v1
- Date: 2026-02
- Confidence: high

## Numbers

### Human between-turn gap, mean across 10 languages (Stivers PNAS)

- Value: +208 ms (mode 0 ms; Japanese +7 ms, Danish +469 ms)
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/

### Practitioner ceiling for conversational voice agents, 2026

- Value: sub-500 ms TTFA minimum target; smooth to ~800 ms; degrades past ~1200 ms
- Source: https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it

### Tuned cascade, Nova-3 + Claude Haiku 4.5 + Cartesia Sonic-3, same region

- Value: 550-700 ms p50
- Source: https://www.forasoft.com/blog/article/voice-ai-agents-livekit-guide

### Cascade per-stage budget (LiveKit)

- Value: VAD 10-50 ms; STT ~200 ms full / <100 ms partials; LLM TTFT 300-800 ms; TTS first chunk 100-200 ms; streamed total 400-800 ms
- Source: https://livekit.com/blog/sequential-pipeline-architecture-voice-agents

### OpenAI gpt-realtime-2.1 audio pricing

- Value: $32.00 /1M in, $0.40 /1M cached in, $64.00 /1M out
- Source: https://developers.openai.com/api/docs/pricing

### OpenAI gpt-realtime-2.1-mini audio pricing

- Value: $10.00 /1M in, $0.30 /1M cached in, $20.00 /1M out
- Source: https://developers.openai.com/api/docs/pricing

### OpenAI transcription models, per minute

- Value: gpt-transcribe $0.0045; gpt-4o-transcribe $0.006; gpt-4o-mini-transcribe $0.003; gpt-live-transcribe $0.017; whisper $0.006
- Source: https://developers.openai.com/api/docs/pricing

### Gemini Live native audio pricing

- Value: $3.00 /1M audio in, $12.00 /1M audio out; 25 tokens per second of audio; ~$0.0368/min effective
- Source: https://ai.google.dev/gemini-api/docs/pricing

### Pipecat Smart Turn v3 size and speed

- Value: 8 MB int8 / 32 MB fp32, ~8M params; 12.6 ms (c7a.2xlarge) to 94.8 ms (t3.medium); 23 languages; BSD-2
- Source: https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/

### Smart Turn v3 Chinese accuracy

- Value: 88.57% (FP 4.76%, FN 6.67%); English 94.31%
- Source: https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/

### LiveKit turn-detector v0.4.1-intl

- Value: Qwen2.5-0.5B INT8 ONNX, <500 MB RAM; 39.23% fewer false-positive interruptions; Chinese error 18.70% → 13.40%
- Source: https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39

### TEN VAD footprint and speed

- Value: 320 KB iOS arm64 library; RTF 0.0086-0.057; 16 kHz, 10/16 ms hop; WASM build available; Apache 2.0 + conditions
- Source: https://huggingface.co/TEN-framework/ten-vad

### Silero VAD v6

- Value: ~309K params, ~1.2 MB, ONNX opset 15/16
- Source: https://soniqo.audio/guides/vad

### Apple SpeechTranscriber first-word latency (one reported migration)

- Value: 780 ms → 140 ms; on-device, free; locales include zh_CN, zh_HK, zh_TW, yue_CN
- Source: https://developer.apple.com/videos/play/wwdc2025/277/

### Mandarin CER, AISHELL-1 / WenetSpeech-Meeting

- Value: Doubao-ASR API 1.52% / 4.74%; Fun-ASR API 1.64% / 5.78%; Paraformer-Large 1.68% / ~6.5%; Whisper large-v3 5.14% / 18.87%
- Source: https://ruoqijin.com/blog/asr-deep-dive-2025-2026

### Chinese streaming ASR list price

- Value: Alibaba fun-asr-realtime ¥0.00033/second (¥1.19/hr); survey table: Bailian ¥0.288/hr, Volcengine ¥0.90/hr, Tencent ¥1.80/hr, Baidu ¥3.00/hr
- Source: https://help.aliyun.com/zh/model-studio/fun-asr-realtime

### TTS vendor-claimed TTFB (all exclude network)

- Value: ElevenLabs Flash v2.5 ~75 ms; ElevenLabs v3 Conversational ~280 ms; Cartesia Sonic-3 ~90 ms / Turbo ~40 ms; Deepgram Aura-2 ~90 ms steady, p95 90-200 ms; MiniMax speech-2.6 <250 ms
- Source: https://elevenlabs.io/docs/models

### TTS price per 1M characters

- Value: ElevenLabs Flash v2.5 $50; Deepgram Aura-2 $30; OpenAI tts-1 $15 / tts-1-hd $30; Cartesia ~$5-37 by plan; MiniMax speech-2.6-turbo ~$60 (reseller)
- Source: https://developers.openai.com/api/docs/pricing

### Streaming STT latency and price (Coval, June 2026)

- Value: Deepgram Flux sub-300 ms, $0.0048-0.0078/min; AssemblyAI Universal-3 Pro 300-600 ms median, $0.45/hr; ElevenLabs Scribe v2 Realtime sub-150 ms; Gladia ~300 ms, $0.75/hr; Soniox streaming from $0.12/hr
- Source: https://www.coval.ai/blog/best-speech-to-text-providers-in-2026-independent-benchmarks-and-how-to-choose/

### Kokoro-82M on Apple silicon

- Value: ~82M params, ~80 MB int8; 12-79x realtime via CoreML/ANE; ~3.3x realtime on iPhone 13 Pro (MLX Swift); iOS package MIT, English-only
- Source: https://github.com/adriancmurray/kokoro-ios

### Voice-agent platform per-minute list prices

- Value: LiveKit Cloud $0.01/min agent session (1,000 free/mo); Vapi $0.05/min orchestration only; Retell $0.07/min; ElevenLabs Agents $0.08/min + LLM
- Source: https://livekit.com/pricing

### Full-Duplex-Bench v3 under tool calls

- Value: GPT-Realtime Pass@1 0.600, interruption rate 13.5%; latency Gemini Live 3.1 4.25 s fastest, cascaded 10.12 s slowest
- Source: https://arxiv.org/abs/2604.04847

### Estimated all-in cost per hour of companion conversation, 2026

- Value: on-device ears+mouth + Haiku $0.12-0.48; Chinese cloud cascade $0.66-1.02; Gemini Live ~$2.21; OpenAI Realtime $3-6; ElevenLabs Agents ~$5
- Source: https://developers.openai.com/api/docs/pricing

## Fact-check

### [4] Tuned 2026 cascade (Deepgram Nova-3 + Claude Haiku 4.5 + Cartesia Sonic-3, single region) = 550-700ms p50; vanilla AgentSession = 1.2-1.4s p95; optimized = 500-650ms p95; LiveKit per-stage budget as stated; Opus 5 with 'adaptive thinking always on' is not a voice-loop model.

- Verdict: **corrected**

Correction: Two sub-claims don't hold. (1) The forasoft article gives vanilla p95 (1.2-1.4s) and tuned p50 (550-700ms) but contains no 'optimized ... 500-650ms p95' figure anywhere — a full scan of every 'p95' occurrence in the article turns up only two: the vanilla-AgentSession line and an unrelated OpenAI gpt-realtime-2.1 caching stat. That p95-for-the-optimized-stack number is not in the cited source. (2) 'Adaptive thinking always on' is Anthropic's label for Claude Fable 5, not Opus 5 — Anthropic's own model pages list Opus 5's Thinking as plain 'Adaptive' (not 'always on') and state explicitly for Opus 5: 'On by default. Disabling thinking requires effort high or below,' i.e. it CAN be turned off, unlike Fable 5.

Evidence: https://www.forasoft.com/blog/article/voice-ai-agents-livekit-guide (full p95-occurrence scan: only 'cutting speech-to-speech p95 by ~25%' [OpenAI] and 'A vanilla, untuned AgentSession starts around 1.2–1.4 s p95' — no tuned/optimized p95 number); LiveKit per-stage budget (VAD 10-50ms, STT ~200ms/<100ms partial, LLM TTFT 300-800ms, TTS 100-200ms, naive 1000-2000ms+, streamed 400-800ms) independently confirmed at https://livekit.com/blog/sequential-pipeline-architecture-voice-agents. Opus 5 thinking mode: https://platform.claude.com/docs/en/models/opus-5/overview ('Thinking: Adaptive'; 'On by default. Disabling thinking requires effort high or below') vs https://platform.claude.com/docs/en/models/fable-5/overview pattern where only Fable 5 carries 'Adaptive (always on)' per the models overview table.

### [6] Gemini Live native audio ~10x cheaper than OpenAI at $3/$12 per 1M audio tokens for gemini-2.5-flash-native-audio-preview-12-2025 (text $0.50/$2.00), billed at 25 tokens/sec ≈ $0.0368/min; every Live model still Preview on the Gemini Developer API; Vertex GA at I/O 2026 only from secondary sources.

- Verdict: **corrected**

Correction: The $3.00/$12.00 audio and $0.50/$2.00 text pricing for gemini-2.5-flash-native-audio-preview-12-2025 is correct, and both cited Live models are indeed labeled Preview (models page: explicit 'Preview models may change...' disclaimer on the native-audio model; 'Gemini 3.1 Flash Live Preview' name and 'New Preview' tag on the other) — so the core capability claim holds. But the '25 tokens per second... ≈$0.0368/min' quote is misattributed: on Google's own pricing page that exact sentence appears only under gemini-3.5-live-translate-preview, a different, pricier model ($3.50/1M in, $21.00/1M out — 0.0053+0.0315=$0.0368/min, which is where the $0.0368 actually comes from), not under gemini-2.5-flash-native-audio-preview-12-2025 ($3/$12). Google's page states this billing methodology 'does not appear applied generally to other Live API models.' The report's derived arithmetic ($0.0045/min in, $0.018/min out at $3/$12) is the report's own extrapolation of the 25-tok/s convention onto a model Google didn't state it for, not a confirmed Google figure.

Evidence: https://ai.google.dev/gemini-api/docs/pricing (gemini-2.5-flash-native-audio-preview-12-2025: audio in $3.00/1M, out $12.00/1M, text $0.50/$2.00, marked Preview; gemini-3.5-live-translate-preview: audio in $3.50/1M ($0.0053/min), out $21.00/1M ($0.0315/min), with the exact '25 tokens per second... ≈$0.0368/min' footnote attached only to this model). https://ai.google.dev/gemini-api/docs/models (gemini-3.1-flash-live-preview shown as 'New Preview').

### [7] Pipecat Smart Turn v3: 8MB int8 ONNX / 32MB fp32, ~8M params, 12.6ms server CPU (up to ~57-95ms on weaker CPUs), BSD-2-Clause, 23 languages incl. Chinese; v3.1 (2025-12-03) raised English to 94.7%/95.6%, Spanish to 90.1%, at 9-57ms CPU.

- Verdict: **corrected**

Correction: All v3 specifics confirmed: 8MB int8/~8M params, 12.6ms (c7a.2xlarge)/33.8ms (t3.2xlarge)/94.8ms (t3.medium), 23 languages, BSD-2-Clause license (confirmed on the GitHub repo: 'This is a truly open model (BSD 2-clause license)'), Chinese 88.57% (FP 4.76%, FN 6.67%), English 94.31%. The v3.1-specific figures (94.7%/95.6% English, 90.1% Spanish, 9-57ms) could not be located in any source reachable here — the pipecat-ai/smart-turn GitHub repo now documents a newer v3.2 and shows no v3.1 release notes or per-version accuracy table, and it has no GitHub Releases entries at all. Treat the v3.1 sub-claim as unverifiable (superseded/unpublished at the sources I could reach), while the cited v3 announcement's own numbers are all confirmed accurate.

Evidence: https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/ (all v3 numbers match); https://github.com/pipecat-ai/smart-turn (BSD-2-Clause confirmed; repo currently documents v3.2, no v3.1 changelog found; Releases page empty).

### [8] LiveKit turn detector v0.4.1-intl: Qwen2.5-0.5B-Instruct distilled from Qwen2.5-7B teacher, INT8 ONNX, <500MB RAM, 39.23% fewer false-positive interruptions, overall error 18.66%→11.34% at 99.3% TP rate, Chinese 18.70%→13.40%, 14 languages, open weights on Hugging Face — a server component unsuitable for an iPad process.

- Verdict: **corrected**

Correction: Every technical/accuracy number confirmed. But 'open weights on Hugging Face' is misleading as stated: the weights ARE downloadable from Hugging Face, but under a custom 'LiveKit Model License,' not an open-source license — it explicitly prohibits using the model 'on a standalone basis or with any frameworks other than LiveKit Agents,' bars using its outputs 'to improve or otherwise develop any other models,' and restricts redistribution. This is a proprietary, platform-locked license, not the BSD-2-Clause openness the report grants to the Smart Turn model it's being contrasted against in the same claim. Doesn't change the RAM/iPad conclusion, but the 'open weights' framing overstates how freely this model can actually be used outside LiveKit's own stack.

Evidence: https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39 (Qwen2.5-0.5B-Instruct distilled from Qwen2.5-7B; 39.23% relative FP reduction; overall 18.66%→11.34% at 99.3% TP; Chinese 18.70%→13.40%). https://huggingface.co/livekit/turn-detector (INT8 model_q8.onnx; RAM <500MB for multilingual model; 14 languages listed explicitly: English, Spanish, French, German, Italian, Portuguese, Dutch, Chinese, Japanese, Korean, Indonesian, Turkish, Russian, Hindi; license = 'LiveKit Model License', text at https://huggingface.co/livekit/turn-detector/blob/main/LICENSE confirms the framework-lock-in and redistribution restrictions quoted above).

### N8. Gemini Live native audio pricing = $3.00/1M audio in, $12.00/1M audio out; 25 tokens/sec; ~$0.0368/min effective.

- Verdict: **corrected**

Correction: The $3.00/$12.00 per-1M pricing for gemini-2.5-flash-native-audio-preview-12-2025 is correct. But the '25 tokens per second ≈ $0.0368/min' statement is not Google's stated billing description for this model — that exact sentence, on Google's own pricing page, is attached only to the different (and pricier) gemini-3.5-live-translate-preview model, whose $3.50/1M in + $21.00/1M out pricing is what actually produces $0.0368/min (0.0053+0.0315). Applying the 25-tok/s convention to the $3/$12 model to get '$0.0045/min in, $0.018/min out' is the report's own unconfirmed extrapolation, not a number Google publishes for that model.

Evidence: https://ai.google.dev/gemini-api/docs/pricing — gemini-2.5-flash-native-audio-preview-12-2025 row has no tokens-per-second billing note; the note appears verbatim only under gemini-3.5-live-translate-preview ($3.50/$21.00, footnote: 'Billing is based on total input and output audio token consumption, calculated at a rate of 25 tokens per second of audio, equating to an effective price of approximately $0.0368 per minute.').

### N11. LiveKit turn-detector v0.4.1-intl = Qwen2.5-0.5B INT8 ONNX, <500MB RAM; 39.23% fewer false-positive interruptions; Chinese error 18.70%→13.40%.

- Verdict: **corrected**

Correction: All the quantitative figures are confirmed correct. The correction is about what the number implies for adoption, not the number itself: this model's weights on Hugging Face carry a custom 'LiveKit Model License' that forbids standalone use or use with any framework other than LiveKit Agents and restricts using its outputs to train other models — i.e. it is not freely reusable the way the report's framing (paired with Smart Turn's BSD-2-Clause openness) might suggest. See claim 8 for the license text.

Evidence: https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39 (all core numbers confirmed); https://huggingface.co/livekit/turn-detector/blob/main/LICENSE (framework-lock-in and redistribution restrictions).

## Dead ends

- Waiting for an Anthropic realtime or audio API — no audio input or output exists on any Claude model, and the SDK feature request was closed as not planned in Feb 2026.
- Adopting Claude's own voice mode — it is a consumer-app feature gated to claude.ai account auth, explicitly unavailable via API key, Bedrock, Vertex or Foundry.
- Running the audio loop in the Tauri WebView via getUserMedia — WKWebView mutes mic capture on backgrounding, Tauri v2 has open iOS permission-prompt bugs, and iOS echo cancellation only exists behind AVAudioSession/VPIO.
- AVSpeechSynthesizer as the companion's voice — it cannot accept streaming text, so TTS cannot start on the first LLM tokens, which is the single biggest latency win in a cascade.
- Whisper (whisper.cpp / WhisperKit) as the on-device Mandarin ASR — 5.14% CER on AISHELL-1 versus 1.5-1.7% for Chinese-native models, and no true streaming.
- LiveKit's turn detector on the iPad — it is Qwen2.5-0.5B needing <500MB RAM; use Pipecat Smart Turn v3 (8MB) for on-device and accept lower Chinese accuracy.
- Vapi / Retell / telephony-shaped platforms — $0.05-0.07/min orchestration priced around phone calls for a loop that never touches a phone.
- Replacing Claude with an end-to-end speech-to-speech model to hit 200ms — you would be swapping out the brain, and under tool calls the fast models lose turn-taking correctness (Gemini Live 3.1 at 78.0% versus a perfect cascade).
- Trusting any published TTS time-to-first-byte — every number including Coval's "independent" comparison is a vendor figure measured without network; no reproducible third-party TTFB benchmark exists.
- Opus 5 as the voice-turn model — adaptive thinking is always on and its comparative latency is "Moderate"; the voice loop needs Haiku-class TTFT.

## Open questions

- No reproducible third-party end-to-end latency measurement exists for any Chinese-language realtime voice stack; every number is vendor-reported or a single blog.
- Mandarin WER is unpublished for Deepgram Nova-3 and for Apple's SpeechTranscriber; AssemblyAI's cheap Universal-Streaming tier appears not to include Mandarin at all, only the pricier Universal-3.5 Pro Realtime does.
- Volcengine/Doubao's official per-character TTS price and its end-to-end realtime voice API per-minute price are not published in the docs reachable from outside China — only a ¥150/year per-voice fee and character packs surfaced, and the pricing doc itself returned empty.
- Whether ElevenLabs Flash v2.5 or Cartesia Sonic Chinese prosody is acceptable to a native ear — no measurement or listening test found, and Chinese TTS quality comparisons were cut off by the search budget.
- Kokoro-82M-v1.1-zh (100 Chinese speakers) has no found iOS/CoreML port; whether the existing CoreML conversion pipeline handles the zh checkpoint is untested.
- Gemini Live's status on the Gemini Developer API is still Preview on Google's own models page; the claimed Vertex AI GA at Google I/O 2026 rests only on secondary sources.
- OpenAI publishes no default millisecond values for server_vad (threshold, prefix_padding_ms, silence_duration_ms) or for semantic_vad eagerness levels, so the added end-of-turn latency of their built-in detection is unknown.
- The ¥0.288/hr figure for Alibaba streaming ASR in the April 2026 survey conflicts with the official ¥0.00033/second (¥1.19/hr) for fun-asr-realtime; which model the cheaper tier refers to is unresolved.
- sherpa-onnx on-device Chinese streaming ASR and TTS numbers on actual iPhone/iPad hardware could not be refreshed — the search budget ran out before that query.

## Unverifiable
