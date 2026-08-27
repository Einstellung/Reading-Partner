# 开放权重与聚合平台

> TTS 供应商横评的原始输出，机械转写自 JSON，措辞未改。结论已吸收进 [46](../../46-TTS供应商横评.md)。
>
> 本轮的 JSON 是候选表形态（每个候选一组字段加一个 sourceUrl），不是 companion-research 那种一条 finding 一个 Source/Date/Confidence 的形态，逐条日期与置信度在源数据里就不存在，此处不补。抓取日期统一为 2026-08-27。
>
> Fact-check 一节是核查阶段的结果：verdict 为 corrected 或 refuted 的条目推翻或修正了同一份里的原始值，以那一节为准。其中三条关于硅基流动单价的修正本身是错的，见 [README](./README.md)。
>
> 维度：open-and-aggregators。题目：开放权重模型与聚合托管平台（Gitee AI、DeepInfra、Replicate、fal.ai 等），以及端侧自建。

---

## Headline

The open-weight world moved past CosyVoice 2 in Dec 2025 and again in 2026, but almost nobody serves the successors from inside China. The one lead worth chasing is Gitee AI 模力方舟 (ai.gitee.com): it is domestic (TLS handshake 0.125 s from this machine vs 0.085 s for SiliconFlow), it exposes the identical OpenAI-compatible POST /v1/audio/speech that the current Rust code already speaks (verified: the route exists, returns 401 without a key), and its catalogue contains CosyVoice3, Qwen3-TTS, IndexTTS-2, VoxCPM2, GLM-TTS and Step-Audio-TTS-3B — every model that beats CosyVoice2 on Mandarin. Its price is behind a console login and I could not read it; that is the single unknown standing between the current setup and a likely free upgrade. On quality: CosyVoice2-0.5B scores CER 1.45 on seed-tts-eval test-zh; Fun-CosyVoice3-0.5B-2512 (Apache-2.0, Dec 2025, same 0.5B size, same streaming design, 47k downloads/month) scores 0.71–0.81 — roughly half the content-error rate at the same model size, so the relay maths should not change. Everything cheaper than SiliconFlow is hosted in the US: DeepInfra runs Qwen3-TTS with raw-PCM streaming and a 97 ms first-byte claim at ¥0.035/min, and Kokoro at ¥0.0011/min (35× cheaper), but the TLS handshake to api.deepinfra.com measured 0.60–0.63 s from here even through a proxy, which eats the entire 500 ms p90 budget before synthesis starts. No host beats SiliconFlow on quality-per-yuan while staying reachable — the win, if there is one, is a better model at the same price, not a cheaper one. On-device is a dead end for cost: 3 min/day is 18.25 audio-hours a year, ¥42.7 at current prices; no port can pay that back.

## Candidates

### Gitee AI 模力方舟 (ai.gitee.com)

- **模型 ID**：CosyVoice3 (upstream: FunAudioLLM/Fun-CosyVoice3-0.5B-2512, Apache-2.0, 0.5B, released 2025-12)
- **原始价格**：UNPUBLISHED. The model list is public via GET https://ai.gitee.com/v1/models (240 models, 25 audio) but every pricing surface is client-rendered React behind a console login; sitemap, docs (Docusaurus + Scalar), and 5 guessed internal API paths all returned no price.
- **¥/min 折算**：UNKNOWN — the one number that decides this row. For reference the incumbent is ¥0.039/min (SiliconFlow ¥0.05 per 1000 UTF-8 bytes × 780 bytes/min).
- **免费额度**：Unpublished. 模力方舟 has historically given free serverless quota on some models; not verifiable without an account.
- **流式形态**：CosyVoice 3 upstream supports bidirectional streaming — text-in streaming and audio-out streaming — with a first-packet claim of 150 ms (vendor claim, FunAudioLLM README). Whether Gitee's wrapper preserves incremental flush is UNVERIFIED and is the thing to measure first.
- **输出格式**：Unverified on Gitee. CosyVoice 3 natively emits 24 kHz PCM; SiliconFlow's CosyVoice2 endpoint offers mp3/opus/wav/pcm with selectable 8/16/24/32/44.1 kHz, so an OpenAI-shaped Gitee endpoint plausibly matches.
- **协议与工作量**：OpenAI-compatible POST https://ai.gitee.com/v1/audio/speech — VERIFIED by an unauthenticated POST returning {"error":{"code":"401"}}. Same shape as SiliconFlow: a base-URL and model-id change in the existing Rust, not new protocol work.
- **延迟说法**：150 ms first packet — vendor claim by the model authors, not measured, and not measured through Gitee's serving stack. There is no third-party TTS TTFB benchmark to check it against.
- **质量证据**：seed-tts-eval test-zh, self-reported by FunAudioLLM: Fun-CosyVoice3-0.5B-2512_RL CER 0.81 / SIM 77.4; the Qwen3-TTS repo independently tabulates CosyVoice 3 at test-zh WER 0.71. Incumbent CosyVoice2-0.5B is CER 1.45 / test-hard 6.83 / SIM 72.4 on the same set. So ~2× lower content-error rate at identical parameter count. Caveat: seed-tts-eval measures content accuracy and speaker similarity, not prosody — it is the best Mandarin number available and it is still self-reported by the model's own authors.
- **音色**：Unknown count. CosyVoice 3 upstream is zero-shot voice-clone plus instruct control, 9 languages and 18+ Chinese dialects/accents — a cloned or instructed voice suits a companion character better than a fixed news-anchor preset.
- **境内可达**：YES, domestic. Measured from the user's machine 2026-08-27: TLS handshake 0.123–0.132 s (3 runs), real IP 180.76.198.225 (Baidu Cloud). Compare SiliconFlow 0.083–0.095 s. Registration is a Gitee account (Gitee now requires a mainland phone number).
- **本维度结论**：MEASURE THIS FIRST. It is the only candidate that is simultaneously a strict quality upgrade over the incumbent, the same model family and size (so the RTF 0.118 / first-frame 42.7 ms relay economics should carry over), domestically hosted, and reachable through the Rust code you already wrote. Get an API key, read the price in the console, then run the same 40-sentence harness against it. If the price is at or under ¥0.05/1000 bytes this is a free upgrade; if it is 3× that, it still costs ¥130/year at 3 min/day and is probably worth it.
- **Source**：https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512 and https://ai.gitee.com/v1/models

### Gitee AI 模力方舟 (same account, same endpoint)

- **模型 ID**：Qwen3-TTS (upstream open weights: Qwen/Qwen3-TTS-12Hz-1.7B-Base and -0.6B-CustomVoice, Apache-2.0, released 2026-01-22)
- **原始价格**：UNPUBLISHED, same console-login problem. Cross-check: DeepInfra sells the same weights at $20.00/1M characters; Alibaba Bailian sells the API sibling qwen3-tts-flash at ¥0.8/万字符 with 汉字 counted as 2.
- **¥/min 折算**：DeepInfra route: $20/1M × 260 chars/min = $0.0052 × 6.74 = ¥0.035/min (0.90× SiliconFlow). Bailian route: (199×2 + 61)/10000 × ¥0.8 = ¥0.0367/min (0.94×). Gitee route unknown.
- **免费额度**：Bailian gives 1万字符 free per TTS model. DeepInfra gives new-account credit only. Gitee unpublished.
- **流式形态**：Best-in-class on paper: the repo states it will "output the first audio packet immediately after a single character is input", i.e. genuine text-in streaming, via a "Dual-Track hybrid streaming generation architecture". The 12 Hz acoustic tokenizer puts the theoretical chunk floor at ~83 ms of audio per token — coarser than CosyVoice2's measured 42.7 ms first frame, but 83 ms is still ~2% of a 4-second sentence, well inside criterion 1.
- **输出格式**：On DeepInfra: WAV, MP3, FLAC and raw PCM, with "real-time PCM streaming". Sample rate not published. On Gitee, unverified.
- **协议与工作量**：Same OpenAI-compatible /v1/audio/speech on Gitee. DeepInfra also exposes an OpenAI-shaped speech endpoint. Either is a few dozen lines of Rust.
- **延迟说法**：97 ms end-to-end — vendor claim, repeated verbatim by DeepInfra as "~97ms first-byte latency". No hardware stated, no third-party confirmation. Note the tension with your own measurement of the Bailian qwen3-tts-flash API: a FIXED 320.9 ms first frame, i.e. that API buffers. The open weights and the hosted API are not the same serving stack — the 97 ms figure is about the weights.
- **质量证据**：seed-tts-eval, self-reported in the Qwen3-TTS repo: Qwen3-TTS-12Hz-1.7B-Base test-zh WER 0.77 (vs CosyVoice 3 at 0.71 and MiniMax-Speech at 0.83), test-en WER 1.24 (best in that table). Multilingual set: Chinese 0.928 WER / 0.799 SIM. Contradicting signal: Artificial Analysis's human-vote TTS arena puts Qwen3 TTS Flash at Elo 940.4 and Qwen3 TTS at 927.5, near the bottom of 100 models — but the same vendor's Qwen-Audio-3.0-TTS-Plus sits at 1237.3, third overall. That spread inside one vendor's line-up is the clearest evidence that the AA arena is not measuring Mandarin; it publishes no language breakdown and its stated method is "every model speaking its own native voices" with no prompt-language disclosure. Do not read 940 as a Mandarin verdict.
- **音色**：9 preset voices in CustomVoice (Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee) including Beijing and Sichuan dialect speakers; plus ~3 s voice cloning, plus a separate VoiceDesign variant that builds a voice from a natural-language description. Uncle_Fu and the dialect voices are the ones that read as a character rather than an anchor.
- **境内可达**：Via Gitee: yes, domestic. Via Bailian (dashscope.aliyuncs.com): yes, TLS 0.077 s. Via DeepInfra: US-hosted, see the DeepInfra row.
- **本维度结论**：Worth measuring, second priority. You already measured Alibaba's own qwen3-tts-flash and it lost on first-frame granularity (fixed 320.9 ms = 6.6% of the sentence). The open weights claim behaviour the API does not deliver, so a different host of the same weights is a genuinely different experiment — but it is the same model, so the prosody will be what you already heard. Apache-2.0 and a 0.6B variant make this the best candidate for the on-device path later.
- **Source**：https://github.com/QwenLM/Qwen3-TTS and https://deepinfra.com/Qwen/Qwen3-TTS

### BreezeBlue / RESONIA

- **模型 ID**：Breeze TTS 2 (BreezeBlue/Breeze-TTS-2 on HF, 3B params, released 2026-08-25 — two days ago)
- **原始价格**：$34.00 per 1M characters at the first-party endpoint (per Artificial Analysis provider data).
- **¥/min 折算**：$34/1M × 260 chars/min = $0.00884 × 6.74 = ¥0.060/min — 1.53× SiliconFlow. A 3-min daily briefing: ¥65/year.
- **免费额度**：Not published.
- **流式形态**：Yes — "real-time streaming" with a dedicated streaming API; vendor claims under 40 ms time to first audio and RTF 0.32 on an H100. If the 40 ms figure holds it is the best first-frame number of any candidate here, matching CosyVoice2's measured 42.7 ms.
- **输出格式**：Not published on the model card. Unverified whether raw PCM is available.
- **协议与工作量**：First-party API shape not documented publicly; self-hosting needs an H100-class GPU for that RTF, so this is an API play.
- **延迟说法**："under 40 ms time to first audio", RTF 0.32 on NVIDIA H100 — vendor claim on the model card, no third-party measurement.
- **质量证据**：Artificial Analysis Speech Arena Quality Elo 1213.3 — the highest-rated OPEN-WEIGHT model of the 100 in that arena, and 6th overall, above Gemini 3.1 Flash TTS (1210.7), Sonic 3.5 (1198.7) and Eleven v3 (1178.3). This is a real third-party human-preference number, not a vendor claim. The caveat above applies: no Mandarin breakdown is published. The model card gives no WER/CER at all. Its HF card declares languages en + zh and shows a Simplified-Chinese example.
- **音色**：Voice-clone, voice-design and "voice-direction" (instruct) capabilities; no fixed preset count published. Voice-design is exactly what a companion character wants.
- **境内可达**：UNVERIFIED and probably not domestic. Two days old, no China presence found. I could not measure it — see the note on this machine's proxy.
- **本维度结论**：The most interesting quality signal in the whole survey and the one thing that might genuinely beat CosyVoice on naturalness — but it is 1.5× the price, two days old, its Mandarin is unquantified, and its China latency is unknown. Licence needs your attention: code is Apache-2.0 but the WEIGHTS are "research and non-commercial use only", commercial use requires authorisation from RESONIA, INC. Your app is PolyForm-NC so the spirit matches, but that clause governs the weights and self-hosted output, not the hosted API. Listen to its Chinese demos before spending any engineering time.
- **Source**：https://huggingface.co/BreezeBlue/Breeze-TTS-2

### SiliconFlow (the incumbent account, no integration work at all)

- **模型 ID**：fnlp/MOSS-TTSD-v0.5 (OpenMOSS / Fudan)
- **原始价格**：¥0.05 per 1K UTF-8 — identical to FunAudioLLM/CosyVoice2-0.5B on the same pricing page.
- **¥/min 折算**：¥0.039/min — exactly the same as what you pay now, by construction.
- **免费额度**：Same SiliconFlow account balance; SenseVoiceSmall (ASR) is the only free speech model listed.
- **流式形态**：Same endpoint and same OpenAI streaming path as CosyVoice2 — with_streaming_response.create(). Whether MOSS-TTSD flushes as incrementally as CosyVoice2's 42.7 ms first frame is unmeasured.
- **输出格式**：Same endpoint contract: mp3 / opus / wav / pcm; wav+pcm at 8000/16000/24000/32000/44100 Hz, default 44100. Raw PCM at a selectable rate, which is what the Swift AVAudioPlayerNode path wants.
- **协议与工作量**：Already implemented. Change one string.
- **延迟说法**：None published.
- **质量证据**：Weak. No seed-tts-eval number found, no arena entry. MOSS-TTSD is designed for two-speaker dialogue/podcast synthesis, which is a different job from single-voice narration; its sibling MOSS-TTS-v1.5 (Apache-2.0, 8B) pulls 363k downloads/month but publishes no Mandarin CER either.
- **音色**：Dialogue-oriented, voice-clone driven. Not obviously a companion voice.
- **境内可达**：YES, domestic, already proven in production. TLS 0.083–0.095 s measured today.
- **本维度结论**：The zero-cost experiment. It is on the account you already have, at the price you already pay, behind the code you already wrote — a 40-sentence run costs one afternoon and nothing else. Expectation is low (dialogue model, no Mandarin benchmark, no latency claim), but it is the only alternative that can be tested without opening a new vendor relationship. Worth an hour, not a day. Note the corollary: SiliconFlow lists exactly two TTS models and neither is CosyVoice3 — they have not shipped the December 2025 upgrade, which is why this survey points at Gitee.
- **Source**：https://siliconflow.cn/pricing

### Fish Audio (first-party) / Novita

- **模型 ID**：fishaudio/s2-pro — Fish Audio S2 Pro, ~4B backbone + 400M fast-AR head
- **原始价格**：$15.00 per 1M characters at both Fish Audio and Novita.
- **¥/min 折算**：$15/1M × 260 = $0.0039 × 6.74 = ¥0.026/min — 0.67× SiliconFlow, i.e. a third cheaper. ¥29/year at 3 min/day.
- **免费额度**：Not published on the pricing surfaces I could read.
- **流式形态**：Yes. Vendor claims time-to-first-audio ~100 ms and RTF 0.195, served on SGLang with continuous batching and prefix caching, 3000+ acoustic tokens/s.
- **输出格式**：Not confirmed from the sources I could read; Fish's API historically offers wav/mp3/opus. Raw PCM unverified.
- **协议与工作量**：Bespoke REST (fish.audio API) or Novita's OpenAI-ish wrapper. Moderate Rust work — not a WebSocket session protocol, but not a drop-in either.
- **延迟说法**：~100 ms TTFA, RTF 0.195 — vendor claims. Artificial Analysis measured 94.3 characters/second and 6.37 s median full-clip generation, but AA explicitly does not measure time-to-first-audio, so it cannot corroborate the 100 ms.
- **质量证据**：The strongest self-reported Mandarin number in the survey: Seed-TTS-Eval Chinese WER 0.54%, claimed "best overall", explicitly claimed to beat Qwen3-TTS and MiniMax Speech-02, plus an 81.88% win rate on EmergentTTS-Eval. Third-party cross-check: Artificial Analysis puts Fish Audio S2.1 Pro at Elo 1146.4 and S2 Pro at 1126.7 — respectable, mid-table, well below Breeze TTS 2's 1213. The gap between "claims best WER" and "11th on human preference" is the usual gap between content accuracy and prosody.
- **音色**：Voice-clone driven, plus a marketplace of community voices. Open weights (fishaudio/s2-pro, 400k downloads/month) mean self-hosting is possible but 4B needs a real GPU.
- **境内可达**：NO, not domestically. api.fish.audio measured TLS 0.592 s from this machine and that was THROUGH a proxy (see caveat). Novita likewise: api.novita.ai TLS 0.805 s proxied.
- **本维度结论**：Best Mandarin WER claim + a third cheaper + real streaming, and it is the one row where a cheaper host genuinely does beat SiliconFlow on paper. It fails on geography. Licence is also a problem for self-hosting: "FISH AUDIO RESEARCH LICENSE" with the README warning "We will take action against any violation of the license." File this as the answer if you ever accept a proxy on the device, and not before.
- **Source**：https://github.com/fishaudio/fish-speech

### DeepInfra

- **模型 ID**：ResembleAI/chatterbox-multilingual (and chatterbox-turbo), MIT-licensed weights
- **原始价格**：$1.00 per 1M characters.
- **¥/min 折算**：$1/1M × 260 = $0.00026 × 6.74 = ¥0.0018/min — 0.045× SiliconFlow, i.e. 22× cheaper. ¥2/year at 3 min/day.
- **免费额度**：DeepInfra new-account credit only; no standing free tier for TTS.
- **流式形态**：Not documented as streaming on DeepInfra's model listing. Chatterbox upstream is a diffusion/flow model that generates a whole utterance — it very likely buffers the sentence, which fails criterion 1 outright.
- **输出格式**：WAV out; PCM streaming not advertised for this model (unlike DeepInfra's Qwen3-TTS row, which explicitly says PCM streaming).
- **协议与工作量**：DeepInfra's OpenAI-compatible speech endpoint. Trivial Rust work.
- **延迟说法**：None published.
- **质量证据**：Artificial Analysis Quality Elo 1020.4 (Chatterbox) and 1092.9 (Chatterbox HD) — bottom third of the arena. No Mandarin CER published. Resemble's multilingual variant covers Chinese among 23 languages but nobody has published a Mandarin score for it.
- **音色**：Voice-clone from a short reference; no curated preset set.
- **境内可达**：NO, US-hosted. api.deepinfra.com real IP 38.101.151.13, TLS handshake 0.605–0.629 s measured through a proxy.
- **本维度结论**：The honest answer is no. It is 22× cheaper and that is genuinely tempting for a 10-minute-a-day future, but it is overseas, it almost certainly buffers the whole sentence, and its Mandarin has no published evidence of any kind. Cheap does not help when the relay starves. Listed only so the cheap tier is not a mystery.
- **Source**：https://deepinfra.com/models/text-to-speech

### DeepInfra / Replicate

- **模型 ID**：hexgrad/Kokoro-82M (v1.0, 82M params, Apache-2.0) — and the separate hexgrad/Kokoro-82M-v1.1-zh
- **原始价格**：$0.62 per 1M characters (DeepInfra); $0.65 (Replicate). The cheapest TTS on the Artificial Analysis comparison, by their own note.
- **¥/min 折算**：$0.62/1M × 260 = $0.000161 × 6.74 = ¥0.0011/min — 0.028× SiliconFlow, i.e. 35× cheaper. ¥1.2/year at 3 min/day. Effectively free.
- **免费额度**：None standing.
- **流式形态**：Not advertised. Kokoro is a small non-autoregressive model that synthesises a whole utterance in one pass — it will buffer. That said, at 82M its RTF is so low that buffering a sentence may take less time than a big model's first packet; AA measured 233 characters/second on Replicate. Criterion 1 is failed on the letter; criterion 2 and 3 might survive it.
- **输出格式**：WAV / 24 kHz. Also available as ONNX (onnx-community/Kokoro-82M-v1.0-ONNX, 1.2M downloads/month), which matters for the on-device row.
- **协议与工作量**：OpenAI-compatible on DeepInfra. Trivial.
- **延迟说法**：None published. AA's 233 ch/s is full-clip throughput, not first-audio.
- **质量证据**：Artificial Analysis Elo 1060.1 — mid-table, and remarkable for 82M parameters, but that is an English-weighted number. For Mandarin specifically the evidence is BAD: Chinese lives in a separate branch, hexgrad/Kokoro-82M-v1.1-zh, published 2025-02-26, which its own card describes as "released early to gather feedback on new voices and tokenization" and "not a strict upgrade" because it drops many voices. It cost ~$110 of compute (120 A100-hours). It draws 18k downloads/month against the main model's 12.3M — a 1-in-680 ratio that tells you what the community thinks of it.
- **音色**：100 Chinese speakers in the v1.1-zh branch, but trained on a professional dataset plus only ~3 hours of crowdsourced synthetic English.
- **境内可达**：NO, both hosts are US. Replicate real IP 104.18.2.60, TLS 0.538–0.554 s proxied.
- **本维度结论**：This is the row where I have to be blunt in the unhelpful direction. Kokoro is 35× cheaper and it is the model everyone points at, but its Mandarin is a side experiment its own author disclaims, and it is hosted overseas. It is not a serious contender for a daily Mandarin briefing. Its real value to this project is the on-device row: 82M in ONNX is small enough to run in-app, which is a different conversation from cost.
- **Source**：https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh

### Gitee AI 模力方舟 (third model on the same account)

- **模型 ID**：VoxCPM2 (openbmb/VoxCPM2, 2B, Apache-2.0, "free for commercial use", arXiv 2509.24650)
- **原始价格**：UNPUBLISHED on Gitee (same console-login problem). Not offered by any other host I found.
- **¥/min 折算**：UNKNOWN.
- **免费额度**：Unpublished.
- **流式形态**：Yes — "Real-Time Streaming" is a headline feature. RTF ~0.30 standard, ~0.13 with Nano-vLLM acceleration, on an RTX 4090. RTF 0.13–0.30 clears criterion 2 with room, but chunk granularity is not published.
- **输出格式**：Not published on the model card.
- **协议与工作量**：Same Gitee OpenAI-compatible endpoint, or self-host.
- **延迟说法**：No first-packet figure published; only RTF.
- **质量证据**：The card claims "state-of-the-art or competitive" on Seed-TTS-eval, CV3-eval, InstructTTSEval and the MiniMax Multilingual Test but prints no numbers on the HF page — the tables are in the GitHub repo, which I did not open. 1549 likes and 320k downloads/month on HF, which is real adoption. Not present in the Artificial Analysis arena.
- **音色**：30 languages plus NINE Chinese dialects named explicitly: 四川话, 粤语, 吴语, 东北话, 河南话, 陕西话, 山东话, 天津话, 闽南话. The widest dialect coverage of anything here, and dialect is the cheapest route to a voice that reads as a companion rather than a broadcaster.
- **境内可达**：YES via Gitee (domestic, TLS 0.125 s). OpenBMB is a Beijing lab (面壁智能/清华).
- **本维度结论**：Third in the Gitee queue, behind CosyVoice3 and Qwen3-TTS. Apache-2.0 with an explicit commercial grant is the cleanest licence of any 2026-class model here, and 2B with RTF 0.13 is a workable size. But it publishes no first-packet number and no visible Mandarin CER, so it is a measure-to-find-out rather than a promise. Only worth the API key if you are already on Gitee for CosyVoice3.
- **Source**：https://huggingface.co/openbmb/VoxCPM2

### On-device (no vendor) — sherpa-onnx + ZipVoice

- **模型 ID**：k2-fsa/ZipVoice (123M params, Apache-2.0) or Matcha-TTS zh+en, run through k2-fsa/sherpa-onnx (Apache-2.0), which ships ios-swift and ios-swiftui example apps
- **原始价格**：Free forever. Compute is the user's device.
- **¥/min 折算**：¥0. The number it has to beat is ¥42.7/year — 18.25 audio-hours at 3 min/day.
- **免费额度**：n/a
- **流式形态**：NO. ZipVoice is flow-matching: it generates the whole utterance in one pass, so criterion 1 is failed by construction. It survives only if the whole-sentence RTF on an iPad is low enough that buffering beats a network round trip — which nobody has measured.
- **输出格式**：Raw PCM in-process. No network, no decode, no format negotiation. Architecturally this is the cleanest possible fit for the Swift AVAudioPlayerNode path.
- **协议与工作量**：None. C++ library linked into the app. This is the largest engineering item in the survey and the only one that is not "change a base URL".
- **延迟说法**：No published RTF for ANY Mandarin TTS on A-series or M-series silicon. That absence is the finding.
- **质量证据**：NONE published for Mandarin. ZipVoice's README claims "state-of-the-art performance in speaker similarity, intelligibility, and naturalness" and prints no numbers. No arena entry, no seed-tts-eval score I could find. Adjacent published Apple-silicon datapoint: GPT-SoVITS reports RTF 0.526 on an M4 CPU — proof that a 2025-class Mandarin model can run faster than real time on M-series silicon, but GPT-SoVITS has no iOS port and needs a per-voice fine-tune. Two other small candidates exist: Supertone/supertonic-3 (99M, ONNX, OpenRAIL-M, 31 languages including Chinese, "runs fast on CPU", no Apple RTF published, no CoreML) and mlx-audio-swift (iOS 17+, Apple Silicon M1+, runs Qwen3-TTS / Fish S2 Pro / OmniVoice / MOSS-TTS / IndexTTS on MLX — no published RTF for any of them, on any Apple chip).
- **音色**：ZipVoice is zero-shot clone from a reference clip, so any voice you can record. Matcha-TTS zh is single-speaker.
- **境内可达**：n/a — nothing to reach. This is the only option that works on a plane, and the only one immune to a vendor changing its price or its model.
- **本维度结论**：The honest answer is that nothing usable exists yet, and that the cost argument for building it is zero. sherpa-onnx + ZipVoice is the only combination where every piece exists at once — a small Mandarin model, INT8 ONNX export, an iOS Swift example app, Apache-2.0 throughout — and even that has no streaming design and no measured iPad RTF. Weigh it against the real bar: Apple's AVSpeechSynthesizer already ships zh-CN voices for free, and it is worth noting what that bar actually is — Siri-quality voices are NOT available to third-party apps, and the Enhanced/Premium zh-CN downloads require the user to go to Settings › Accessibility › Spoken Content › Voices themselves because an app cannot trigger the download. So the default-tier Ting-Ting is the realistic fallback and it is clearly synthetic. An on-device model would beat it. It would not pay for itself: ¥42.7/year is the entire prize, and an M-series iPad is required for any of these to have a chance (base A-series iPads have far less headroom). Build this for offline capability if you ever want it, never for cost.
- **Source**：https://github.com/k2-fsa/sherpa-onnx and https://github.com/k2-fsa/ZipVoice

## Ruled out

- ModelScope 魔搭 free inference API — NO TTS AT ALL. Its API-Inference endpoint (https://api-inference.modelscope.cn/v1/models) returns exactly 47 models and every one is an LLM or image model; zero audio, zero TTS. The "魔搭 has a free API" hope is dead for this use case. Fails: not a TTS host.
- PPIO 派欧算力云 (api.ppinfra.com) — NO TTS. Its OpenAI-compatible model list returns 113 models and a regex for tts|voice|speech|audio|cosy|index|fish|spark|kokoro|moss|vox|sovits matches none of them. Domestic and fast (TLS 0.189 s) but there is nothing to buy. Fails: not a TTS host.
- Together AI — no TTS in its catalogue for this survey; not listed as a host for any of the 100 models in the Artificial Analysis TTS comparison. Fails: not a TTS host.
- fal.ai — hosts TTS (Chatterbox at $25/1M = ¥0.044/min, 1.12× SiliconFlow) but is US-hosted and more expensive than the incumbent. Fails criterion 3 (geography) and offers no price advantage to compensate.
- Replicate — Kokoro $0.65/1M, XTTS v2 $40.44/1M, StyleTTS 2 $2.82/1M, OpenVoice v2 $8.33/1M. US-hosted; api.replicate.com measured TLS 0.538–0.554 s even through a proxy. Fails criterion 3.
- F5-TTS (SWivid/F5-TTS) — weights are CC-BY-NC because the Emilia training set is in-the-wild (code is MIT). Last substantive release 2025-03-12, no successor, no v2. "Chunk inference" in the Gradio app is not a streaming server. Fails: no streaming, and stale by 17 months.
- Spark-TTS-0.5B — Apache-2.0 and built on Qwen2.5, but streaming is not mentioned anywhere and the last news entry is 2025-03-12. 981 downloads/month. Fails criterion 1 (no streaming) and abandonment.
- MegaTTS 3 (ByteDance) — Apache-2.0 and only 0.45B, but ByteDance deliberately withheld the WaveVAE ENCODER weights "for security issues", so you cannot encode your own reference audio and are limited to their pre-extracted latents. No streaming. Roadmap stops at March 2025. Fails: crippled weights plus no streaming.
- IndexTTS-2.5 (bilibili, 0.8B, released 2026-08-10) — genuinely current and the licence is fine (bilibili Model Use License: worldwide, royalty-free, separate licence only above 100M MAU or RMB 1B annual revenue — nowhere near you). But streaming is not mentioned anywhere in the repo, and its own numbers are on CV3-Eval where Chinese WER is 4.36 / SIM 77.10 and the 2.5-RL average is WER 6.00. RTF 0.2065 bf16. Fails criterion 1: a non-streaming model makes the per-sentence relay pointless.
- Higgs Audio V3 (bosonai/higgs-tts-3-4b) — "Boson Higgs TTS 3 Research and Non-Commercial License", 4B params, and the damning number is its own: 1,079 ms mean latency per request at 16 concurrency on an H100. Artificial Analysis Elo 1044.9, below Kokoro. Fails criterion 3 by a factor of two on the vendor's own hardware.
- MOSS-TTS v1.5 (OpenMOSS, Apache-2.0) — 8B parameters, no streaming or latency figures published, no Mandarin CER published. Fails: too large to self-host cheaply and no evidence it is better.
- Marvis TTS (marvis-tts-250m) — the most promising on-device architecture on paper (250M + 60M decoder, 500MB quantised, MLX, explicitly targets iPad/iPhone, Apache-2.0) but its card says Mandarin is "coming soon" and there has been no release since v0.1 on 2025-08-26. Fails: does not support Chinese.
- Zonos-v0.1 (Zyphra, $20/1M) — Artificial Analysis Elo exactly 1000.0, the arena's baseline anchor, i.e. bottom quartile. Fails on quality at a price no better than the incumbent.
- XTTS v2 (Coqui) — Elo 920.4 at $40.44/1M on Replicate. Worse and 10× the price. Fails on both axes.
- StyleTTS 2, OpenVoice v2, MetaVoice v1 — Elo 891.3 / 953.8 / 843.9, all below Kokoro's 1060 at 82M params. Fails on quality.
- Self-hosting any of these on rented GPU — the arithmetic kills it before the engineering does. 3 min/day is 18.25 audio-hours per year. Even a ¥1/hour GPU costs ¥8,760/year if left running, against ¥42.7 of API calls; and a serverless GPU that scales to zero pays for it with a cold start measured in seconds, which fails criterion 3 by an order of magnitude. Self-hosting only starts to make sense somewhere north of 6 hours of audio per day. Fails: economics, not capability.
- GPT-SoVITS — MIT licence on both code and pretrained weights, the most permissive here, strong Mandarin support, and a published RTF of 0.526 on an M4 CPU that is the single most useful on-device datapoint in this survey. But it has no streaming API (api.py / api_v2.py document neither streaming nor latency), it expects a per-voice fine-tune workflow, and there is no Swift/CoreML/iOS port. Fails criterion 1, and fails as a hosted option because nobody sells it.

## Open questions

- What does Gitee AI 模力方舟 charge for CosyVoice3, Qwen3-TTS and VoxCPM2? This is the one number that decides the whole survey and I could not get it. Every pricing surface (ai.gitee.com/serverless-api, /docs, the Scalar OpenAPI reference, five guessed internal API paths, the sitemap) is client-rendered React behind a console login. It needs an account: register, open the CosyVoice3 model page, read 价格 and 免费额度. Ten minutes of your time buys the answer this report is missing.
- Does Gitee AI's /v1/audio/speech expose raw PCM at a selectable sample rate, and does it flush incrementally? The route is confirmed to exist and to be OpenAI-shaped (unauthenticated POST returns 401), but response_format and streaming behaviour need a key to test. If it returns MP3 only, the whole Gitee lead collapses — it would put a decoder back in the Swift path that CosyVoice2-on-SiliconFlow currently avoids.
- What does Alibaba Bailian charge for cosyvoice-v3-flash / cosyvoice-v3-plus / cosyvoice-v3.5-flash / cosyvoice-v3.5-plus? Their realtime WebSocket API documents all five model ids alongside qwen3-tts-flash-realtime, supports PCM out to 48 kHz and streaming text in — but the price is not on any page I could fetch (help.aliyun.com's billing table lists qwen-audio-3.0-tts-plus at ¥1.4/万字符 and qwen3-tts-flash at ¥0.8/万字符 and simply omits the cosyvoice line). If cosyvoice-v3.5-flash is priced near qwen3-tts-flash it is ¥0.037/min for the newest CosyVoice from the vendor who built it, on a domestic endpoint you can already reach at TLS 0.077 s. Worth a console check at the same time as Gitee.
- Is DeepInfra actually reachable from a mainland iPad without a proxy, and at what p90? I could not measure it. This machine runs a Mihomo TUN with an ip rule (9002: from all iif lo lookup 2022) that captures every packet, so --noproxy and --resolve both still go through it. Domestic figures here are real (SiliconFlow TLS 0.083–0.095 s, Gitee 0.123–0.132 s, dashscope 0.077 s); every overseas figure (DeepInfra 0.605–0.629 s, Replicate 0.538–0.554 s, Fish 0.592 s, Novita 0.805 s) is PROXIED and is a lower bound at best. The physics is the argument: two RTTs of TLS at 0.6 s implies ~300 ms one-way, so a 97 ms model leaves ~400 ms before jitter against a 500 ms p90 budget. Test it on the iPad on cellular if you care, not on this box.
- Is Breeze TTS 2's Mandarin as good as its Elo suggests? It is the highest-rated open-weight model in the only third-party human-preference arena that exists (1213.3, 6th of 100), it is two days old, and its card publishes no WER or CER at all. Its Chinese demos are the cheapest possible check.
- There is still no reproducible third-party Mandarin TTS quality benchmark, and I want to be explicit that I did not find one. Artificial Analysis's arena is the only real third-party number and it publishes no language breakdown; the evidence that it is not measuring Mandarin is that Alibaba's own line-up splits 940.4 (Qwen3 TTS Flash) against 1237.3 (Qwen-Audio-3.0-TTS-Plus). Every Mandarin number in this report — seed-tts-eval CER, CV3-Eval WER, speaker similarity — is self-reported by the model's own authors on a test set they chose. Treat the ordering CosyVoice3 0.71 / Qwen3-TTS 0.77 / CosyVoice2 1.45 as directionally real and the gaps between the top three as noise.
- Artificial Analysis does not measure time-to-first-audio for any TTS model — its published latency metric is median time to generate a whole ~500-character clip including download. So none of its numbers can corroborate any vendor's first-packet claim, including Breeze's 40 ms, Qwen3-TTS's 97 ms, Fish's 100 ms or CosyVoice's 150 ms. Your own 40-sentence harness remains the only instrument that measures the thing your architecture depends on.

## Fact-check

### [REFUTED] SiliconFlow bills TTS output at ¥0.05 per 1000 UTF-8 BYTES (used to derive the ¥0.039/min incumbent figure via 780 bytes/min = 260 chars × 3 bytes/char).

- **Correction**：Correct unit: ¥0.05 per 1000 UTF-8 CHARACTERS. At 199 汉字/分钟: 199/1000 × 0.05 = ¥0.00995/min ≈ ¥0.0100/min — not ¥0.039/min. This is off by ~292%, far past the 15% threshold, and it is the single most consequential error in the set because every 'x× SiliconFlow' comparison in the document (rows 1,2,3,5,6,7) is anchored to this wrong number.
- **Evidence**：siliconflow.cn/pricing states the unit verbatim as "输出价格（/千字符 UTF-8）" for both CosyVoice2-0.5B and MOSS-TTSD-v0.5 — that is 千字符 (per 1000 CHARACTERS, UTF-8 encoded), not 千字节 (bytes). The ×3 byte-per-character multiplier is fabricated; there is no byte conversion in this price at all.

### [REFUTED] Row 1: 'For reference the incumbent is ¥0.039/min (SiliconFlow ¥0.05 per 1000 UTF-8 bytes × 780 bytes/min)' — used as the comparison baseline for the whole document.

- **Correction**：True incumbent price is ¥0.0100/min, not ¥0.039/min. This means every 'x× SiliconFlow' multiplier stated in the document is wrong by roughly the same factor (~3.9x) — e.g. Fish Audio is actually ~2.0× the incumbent price (not '0.67×, a third cheaper'), DeepInfra Qwen3-TTS is ~2.7× (not '0.90×'), Breeze TTS 2 is ~4.6× (not '1.53×'); only Chatterbox (~0.13×) and Kokoro (~0.08×) remain genuinely cheaper than SiliconFlow. This reverses the document's framing that SiliconFlow is mid-pack — it is actually one of the cheaper character-priced options once the unit is read correctly.
- **Evidence**：Compounds both errors above: wrong unit (bytes vs characters) and wrong rate (260 vs 199 chars/min). See the two checks above.

### [CORRECTED] Row 4 (SiliconFlow / MOSS-TTSD-v0.5): claimed ¥0.039/min.

- **Correction**：¥0.0100/min, not ¥0.039/min (−74%). Source: https://siliconflow.cn/pricing
- **Evidence**：Recomputed from the verified primary-source unit (¥0.05/1000 characters) at 199 汉字/分钟.

### [CORRECTED] Row 2 (Qwen3-TTS, DeepInfra route): $20/1M chars × 260 chars/min = ¥0.035/min.

- **Correction**：$20/1M × 199 × 6.74 = ¥0.0268/min, not ¥0.035/min (+30.6% overstated, exceeds 15% threshold). Relative to the corrected SiliconFlow price this is 2.68× the incumbent, not the claimed 0.90×.
- **Evidence**：Confirmed raw price $20.00/1M characters via https://deepinfra.com/models/text-to-speech (matches). The chars/min multiplier used is 260, but the task's specified base rate is 199 汉字/分钟.

### [CORRECTED] Row 3 (Breeze TTS 2): $34/1M chars × 260 chars/min = ¥0.060/min; ¥65/year at 3 min/day.

- **Correction**：$34/1M × 199 × 6.74 = ¥0.0456/min, not ¥0.060/min (+31.6%). Annual at 3 min/day: 1095 min × ¥0.0456 ≈ ¥50/year, not ¥65/year.
- **Evidence**：Recomputed at the specified 199 汉字/分钟 (raw $34/1M price unverified against a primary billing page — Artificial Analysis provider data was the cited source and I could not independently load a first-party Breeze pricing page).

### [CORRECTED] Row 5 (Fish Audio S2 Pro): $15/1M chars × 260 chars/min = ¥0.026/min; ¥29/year at 3 min/day.

- **Correction**：$15/1M × 199 × 6.74 = ¥0.0201/min, not ¥0.026/min (+29.4%). Annual: 1095 × ¥0.0201 ≈ ¥22/year, not ¥29/year.
- **Evidence**：Raw price confirmed: Novita's pricing page (novita.ai/pricing) lists "Fish Audio Text to Speech: $15 /1M characters", matching the claim. Recomputed the per-minute figure at 199 汉字/分钟 instead of 260.

### [CORRECTED] Row 6 (Chatterbox, DeepInfra): $1/1M chars × 260 chars/min = ¥0.0018/min; ¥2/year at 3 min/day.

- **Correction**：$1/1M × 199 × 6.74 = ¥0.00134/min, not ¥0.0018/min (+34.3%). Annual ≈ ¥1.47/year, not ¥2/year.
- **Evidence**：Raw price confirmed via deepinfra.com/models/text-to-speech: "chatterbox-multilingual: $1.00 per 1M characters", "chatterbox-turbo: $1.00 per 1M characters" — matches. Recomputed at 199 chars/min.

### [CORRECTED] Row 7 (Kokoro-82M, DeepInfra): $0.62/1M chars × 260 chars/min = ¥0.0011/min; ¥1.2/year at 3 min/day.

- **Correction**：$0.62/1M × 199 × 6.74 = ¥0.00083/min, not ¥0.0011/min (+32.4%). Annual ≈ ¥0.91/year, not ¥1.2/year.
- **Evidence**：Raw price confirmed via deepinfra.com/models/text-to-speech: "Kokoro-82M: $0.62 per 1M characters" — matches. Recomputed at 199 chars/min.

### [CORRECTED] Row 3: Breeze TTS 2 output format 'Not published on the model card. Unverified whether raw PCM is available.'

- **Correction**：Output format is published and PCM is confirmed available: 24 kHz / 16-bit / mono PCM — this should read 'confirmed', not 'unverified'.
- **Evidence**：huggingface.co/BreezeBlue/Breeze-TTS-2 model card does publish this: mono 24 kHz, signed 16-bit little-endian PCM.

### [CORRECTED] Row 3: BreezeBlue/Breeze-TTS-2 is presented as an open-weight model with no license caveat noted, alongside cost/quality figures for a purchasing decision.

- **Correction**：This is a material omission for a purchasing decision: if the product has any commercial intent, Breeze TTS 2's weights cannot be licensed for that use as-is, unlike CosyVoice3/Qwen3-TTS/Kokoro/Chatterbox (Apache-2.0/MIT) or the paid API vendors. This should be flagged before any spend decision on this row, independent of its price/quality numbers.
- **Evidence**：The HF model card states the license as the 'BreezeBlue Research and Non-Commercial License' (only the surrounding source code is Apache-2.0; the weights/model itself are research/non-commercial only).

### [CORRECTED] Row 1: '240 models, 25 audio' via GET https://ai.gitee.com/v1/models, unauthenticated and public.

- **Correction**：Endpoint reachability and no-auth-required claim: confirmed. Model counts: now 341 total / ~19 audio-related, not 240/25 — catalog has grown since the original count was taken; treat the counts as a snapshot, not a stable fact.
- **Evidence**：Live GET to https://ai.gitee.com/v1/models today (2026-08-27) returns 341 total models and ~19 audio/tts/speech/voice-named models, unauthenticated (no auth error, plain JSON list) — confirming the endpoint IS public/unauthenticated as claimed, but the specific counts (240/25) are stale.

### [CORRECTED] 6.74 CNY/USD exchange rate used throughout the ¥/min conversions.

- **Correction**：Use ~6.72, not 6.74 — a 0.3% difference, immaterial on its own (not the source of any >15% flag) and small enough that it was kept at 6.74 in the recomputed figures above for consistency with the original document's convention.
- **Evidence**：x-rates.com shows 1 USD ≈ 6.72 CNY as of the check.

### [UNVERIFIABLE] Row 2 (Qwen3-TTS, Bailian route): (199×2 + 61)/10000 × ¥0.8 = ¥0.0367/min, i.e. counting each 汉字 as 2 units plus 61 extra non-Chinese characters per minute.

- **Correction**：If only the specified 199 汉字/分钟 is billed (no extra 61 non-Chinese chars assumed): 199×2/10000 × 0.8 = ¥0.0318/min, ~15.4% below the claimed ¥0.0367/min — right at the flag threshold. Recommend getting this from an authenticated Bailian console screenshot before trusting either figure.
- **Evidence**：Could not independently confirm the ¥0.8/万字符 price or the 'Chinese char = 2 units' billing rule from Alibaba Cloud's own pricing/billing pages — model-studio doc pages fetched (help.aliyun.com/zh/model-studio/qwen-tts, the -billing variant, and the Bailian console) either had no pricing table or were client-rendered/404.

### [UNVERIFIABLE] Row 1: POST https://ai.gitee.com/v1/audio/speech unauthenticated returns {"error":{"code":"401"}}, verifying an OpenAI-compatible endpoint shape.

- **Correction**：None — flagged as unverifiable with available tools, not disputed.
- **Evidence**：WebFetch can only issue GET requests; a GET to the same URL returned HTTP 405 Method Not Allowed, which is consistent with (but does not independently prove) an endpoint that exists and expects POST. Could not reproduce the specific POST/401 behavior with tools available in this check.

### [UNVERIFIABLE] China-reachability TLS handshake measurements (Gitee 0.123–0.132s / real IP 180.76.198.225; SiliconFlow 0.083–0.095s; Fish Audio 0.592s via proxy; Novita 0.805s via proxy; DeepInfra 0.605–0.629s via proxy; Replicate 0.538–0.554s via proxy).

- **Correction**：None — flagged as unverifiable, not disputed.
- **Evidence**：No tool available in this check can perform raw TCP/TLS handshake timing or reproduce the original machine's network vantage point (and several of the original figures are themselves caveated as measured through a proxy). The qualitative claims (Gitee domestic/Baidu Cloud-hosted, SiliconFlow domestic, Fish Audio/Novita/DeepInfra/Replicate US-hosted) are directionally consistent with public knowledge of these providers' infrastructure, but the specific millisecond figures could not be independently reproduced or refuted here.

### [CONFIRMED] Row 1/2 quality evidence: Fun-CosyVoice3-0.5B-2512_RL CER 0.81 / SIM 77.4, CosyVoice 3 test-zh WER 0.71 (per Qwen3-TTS repo table), CosyVoice2-0.5B CER 1.45 / test-hard 6.83 / SIM 72.4; Qwen3-TTS-12Hz-1.7B-Base test-zh WER 0.77, test-en WER 1.24, MiniMax-Speech 0.83; multilingual Chinese 0.928 WER / 0.799 SIM; CosyVoice3 first-packet 150ms bidirectional streaming claim; Qwen3-TTS 'output the first audio packet immediately after a single character' + Dual-Track hybrid streaming architecture.

- **Correction**：No correction needed — figures confirmed as stated; note only the immaterial 12Hz-vs-12.5fps naming quirk.
- **Evidence**：All figures verified exactly against https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512 (CER 0.81/SIM 77.4 for RL variant, CosyVoice2-0.5B baseline 1.45/6.83/72.4, streaming text-in+audio-out latency 'as low as 150ms') and https://github.com/QwenLM/Qwen3-TTS (test-zh WER 0.77/0.71/0.83, test-en 1.24, multilingual 0.928/0.799, Dual-Track streaming architecture, first-packet claim). Minor imprecision only: the tokenizer is named '12Hz' but the repo's actual frame rate figure is 12.5 fps (1000/12.5=80ms vs the row's own '~83ms' estimate) — immaterial, same order of magnitude.

### [CONFIRMED] Row 5 quality evidence: Fish Audio S2 Pro Seed-TTS-Eval Chinese WER 0.54%, 'best overall', explicitly beats Qwen3-TTS and MiniMax Speech-02, 81.88% win rate on EmergentTTS-Eval; TTFA ~100ms, RTF 0.195.

- **Correction**：No numeric correction needed; note the GPU used for the RTF measurement is H200, not H100 as stated.
- **Evidence**：Exact match against https://github.com/fishaudio/fish-speech: WER 0.54% claimed best overall vs Qwen3-TTS (0.77/1.24) and MiniMax Speech-02 (0.99/1.90); EmergentTTS-Eval 81.88% win rate; TTFA ~100ms, RTF 0.195 (measured on H200, not H100 as the row states — minor GPU-model mismatch, not a numeric error).

### [CONFIRMED] Row 7 quality evidence: hexgrad/Kokoro-82M-v1.1-zh released 2025-02-26, card says 'not a strict upgrade' and 'released early to gather feedback on new voices and tokenization', cost ~$110 / 120 A100-hours, draws 18k downloads/month.

- **Correction**：No correction needed — all figures confirmed.
- **Evidence**：Exact match against https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh: release date 2025-02-26, verbatim 'not a strict upgrade... released early to gather feedback on new voices and tokenization', compute cost $110 / 120 A100 80GB hours, 18,144 monthly downloads (≈18k).

### [CONFIRMED] Row 3: Breeze TTS 2 Artificial Analysis Quality Elo 1213.3, '6th overall', 'highest-rated OPEN-WEIGHT model of the 100', above Gemini 3.1 Flash TTS (1210.7), Sonic 3.5 (1198.7), Eleven v3 (1178.3); TTFA <40ms, RTF 0.32 on H100.

- **Correction**：No correction needed — figures confirmed within normal leaderboard drift.
- **Evidence**：Live leaderboard fetch (artificialanalysis.ai/text-to-speech/leaderboard/provider-voice) shows Breeze TTS 2 at rank 6, Elo ~1215, explicitly labeled 'the highest-ranked open weights model on the Text to Speech Leaderboard'; Gemini 3.1 Flash TTS rank 7/Elo 1210, Sonic 3.5 rank 9/Elo 1199, Eleven v3 rank 14/Elo 1177 — all consistent with the row's numbers (small decimal differences are normal live-leaderboard drift). Breeze-TTS-2's own HF card (huggingface.co/BreezeBlue/Breeze-TTS-2) independently confirms TTFA 'under 40 ms' and RTF 0.32 on H100.

