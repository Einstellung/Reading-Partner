# Round 1 / 1 — 已发货的虚拟陪伴产品与它们的技术栈

> 第一轮调研，2026-08-26 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度原题：What has actually shipped: virtual-companion / AI-character / desktop-pet products (2025-2026) and how each is built

---

## Headline

The highest-profile animated AI companion — Grok's Ani — was retired by xAI on 2026-07-24 after ~12 months because the avatar didn't convert, while the one animated-character stack that demonstrably works inside a mainstream app is Duolingo's Rive-driven Lily (a sub-1MB vector state machine), which is the only approach in this survey that runs unchanged inside an iOS WebView.

## Relevance to this repo

The only shipped character stack that runs unchanged inside your Tauri WKWebView is a vector state machine — Rive or Live2D Cubism Web — and both are cheap to adopt: Rive's canvas-lite web runtime is 222 KB brotli and Live2D's Web SDK is officially supported on iOS Safari with a ¥0 license for any entity under ¥10M annual sales, which a non-commercial PolyForm-NC project is. Duolingo's Lily is the proof it works at scale: 8 head × 8 body animations blended into 64+ idle variations in a sub-1MB file, with a state machine exposing named boolean/numeric/trigger inputs that engineers drive from live AI events — that maps one-to-one onto your concept sheet's 8 emotion states and 5 idle actions, and onto how your agent tool-loop already emits structured output. Adoption cost is one asset pipeline (a Rive or Cubism file authored by a designer, with inputs named for code) plus a thin `.ts` module that maps agent events and TTS playback to state-machine inputs — testable, no React dependency, which fits your `.tsx`-is-rendering-only rule. The expensive path is the one xAI took: Animation Inc's on-device 3D model is genuinely impressive at 2.5 ms/frame, but it is a native iOS/Android/Mac/Windows SDK with no web runtime and no published pricing, so reaching it means abandoning the WebView for a native Tauri plugin, and their own app ships at 472 MB. Two independent shipped-product signals should shape scope: xAI killed the highest-profile 3D companion after twelve months because it drove downloads but not revenue, and the products that actually retain — Tolan at >$1M/month, Neuro-sama as Twitch's most-subscribed channel, Moflin, Fuzozo — all use stylized, non-photoreal, often non-human characters, several of which do not speak in words at all. Your glowing blue sprite is already on the correct side of that line; do not let it drift toward realism. On voice, nobody in this survey ships a sub-second animated companion without a server: 650 ms end-to-end is Zhipu's number over Agora RTC, ~1 s is Doubao's, and OpenAI Realtime costs $0.06-0.11/min ($0.02-0.05 on mini), so an always-listening companion is a real recurring cost — which incidentally is what your energy-bar-consumes-tokens concept could honestly visualize. Finally, budget for compliance before code: Apple's new 13+/16+/18+ tiers require you to rate the app for its AI chatbot behaviour, guideline 5.1.2(i) requires explicit disclosure and permission before sending personal data to third-party AI, and a reading app whose companion talks to a child is squarely in the territory that got Character.AI to ban under-18s.

## Findings

### xAI retired the 3D animated Companions (Ani, Mika, Valentine, Rudi, Bad Rudi) on 2026-07-24, keeping only the personalities as prompt layers in ordinary Grok chat.


Official Grok statement dated 2026-07-24: the 3D avatar Companions feature "was an experiment. We're retiring it soon to focus fully on core Grok." No shutdown date was published; the rollout was staggered so some accounts lost the Companion tab before others. What goes away: the companion tab, the 3D avatar, outfit customization, and the real-time voice layer. What stays: chat history, memories, and the personalities themselves — because "the character was always a prompt layer sitting on top of the model." It ran iOS-only at $30/month (SuperGrok). Launch-week economics were weak: daily downloads jumped 40% to 171,000 but revenue rose only 9% to $337,000. Primary X post was 403 to my fetcher; two independent secondary sources quote the same statement text and date.

- Source: https://www.roborhythms.com/grok-companions-discontinued/
- Date: 2026-07
- Confidence: medium
- Runs on device: ios-yes

### Ani's rendering was not built by xAI — it came from Animation Inc, whose on-device generative animation model runs at 2.5 ms/frame, but it is native-SDK only with no web runtime and no published pricing.


Animation Inc's own site: "Our proprietary on-device AI model generates full-body 3D motion in real-time. No motion capture, no cloud, no delay," with "Inference speed: 2.5 ms/frame" — i.e. ~400 fps of headroom for motion generation, leaving rendering as the real budget. They call it "the world's first animation engine fully controlled by a neural network in real time on a device." Platforms listed: iOS, Android, Mac, Windows — no Web/WASM. Docs show SwiftUI integration examples. Founders are the MSQRD (acquired by Meta) and Loóna (Apple Design Award) team; 13 people across Warsaw, Limassol, Palo Alto. Their own first-party app Animates ships 2026-09-11 on iOS 18+, weighs 472.1 MB, rated 18+, with tiers at $7.99 / $19.99 / $39.99 per month. The SDK usage policy page exists but discloses no platforms, pricing, or technical requirements.

- Source: https://www.animation.inc/
- Date: 2026-08
- Confidence: high
- Runs on device: ios-no

### Duolingo's AI Video Call character Lily is the closest shipped precedent to what Reading-Partner wants, and it is a Rive state machine under 1 MB reacting to a live LLM voice session.


Rive's engineering writeup with Duolingo animator quotes: 8 head animations × 8 body animations combined into 64+ neutral variations, with nested artboards separating head and body so they move independently. The Rive State Machine drives mouth positions, facial expressions, camera moves and emotional transitions; engineers integrate one exported runtime file. Senior Animator Jasmine Vahidsafa: "I still can't believe how tiny our Rive files are" — final file under a megabyte. The design constraint is exactly ours: "In a traditional animation pipeline, you'd animate a character's reaction based on a fixed script. But here, we don't know what the learner is going to say." At runtime it syncs to audio, reacts to word taps, stops speaking when the user finishes early, idles with blinks and head nods, and branches to success/failure reactions. No latency or lipsync-algorithm numbers are published.

- Source: https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life
- Date: 2026-01
- Confidence: high
- Runs on device: ios-yes

### Rive ships a web runtime small enough to drop into a WebView: 222 KB brotli for canvas-lite, 567 KB for canvas, 648 KB for webgl2.


Rive's runtime-sizes doc (last updated January 2026), brotli -9: canvas-lite 707 KB uncompressed / 222 KB compressed; canvas 1728 KB / 567 KB; webgl2 2179 KB / 648 KB. canvas-lite "drops the text, layout, audio, and scripting engines to save space." canvas-single inlines the WASM into the JS so loading takes one request instead of two. Rive's own guidance flags one mobile caveat: "Blend modes on mobile are the case where @rive-app/canvas can be meaningfully faster" than the WebGL path. For comparison, the native Apple runtime adds ~1.67 MB download / ~4.66 MB install. No published fps or CPU figures for iOS WKWebView specifically.

- Source: https://rive.app/docs/runtimes/runtime-sizes.md
- Date: 2026-01
- Confidence: high
- Runs on device: ios-yes

### Live2D's Cubism SDK for Web officially supports Safari on iOS, and the license is free for any entity under ¥10,000,000 (~$67k) annual sales.


Live2D lists a TypeScript/WebGL Web SDK supported on Chrome, Firefox, Safari, Edge across Windows, macOS, Linux, Android and iOS. Licensing is freemium: you develop free, and only owe a Publication License fee at release. "General User" and "Small-Scale Enterprise" (annual sales under ¥10M) pay ¥0 under both the one-time-purchase plan and the running-royalty plan. Middle-Scale pays ¥100,000 one-time (or ¥40/unit); on the running-royalty plan Middle-Scale pays ¥50,000 initial per publish region plus ¥20,000/month per platform per region, Large-Scale ¥300,000 + ¥100,000/month. The exemption explicitly excludes "Expandable Applications" — apps where users supply their own models. The FREE Cubism Editor caps a model at 30 parameters, 30 parts, 100 ArtMeshes and refuses to save beyond that; PRO indie annual is ¥14,280/yr. Community runtimes (pixi-live2d-display, and the Cubism 5 / PixiJS 8 fork pixi-live2d5) wrap this for the web.

- Source: https://www.live2d.com/en/sdk/license/running_plan01/
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Neuro-sama proves that flat 2D Live2D plus an LLM plus TTS is enough presence to out-earn every human on Twitch — fidelity is not the bottleneck.


As of 2026-01-02 Neuro-sama had an estimated 162,459 active Twitch subscribers, the most-subscribed channel on the platform, more than double second-place Jynxzi at 73,942, and near 1M followers. At a $5 sub with standard split that is >$400,000/month from subs alone before ads, bits and sponsorships. On 2026-01-04 the channel hit Hype Train level 126 with 262,793 paid subs, roughly $1.5M in platform spend. The stack is a conventional pipeline: mic → VAD → ASR → LLM → emotion tag parsing → Live2D expression + TTS. The comparable open-source implementation, Open-LLM-VTuber (MIT, 13.5k stars), is a web frontend plus Python backend with pluggable ASR (sherpa-onnx, FunASR, faster-whisper, whisper.cpp) and TTS (sherpa-onnx, MeloTTS, Coqui, Edge TTS) — Windows/macOS/Linux only, no iOS build. Its browser frontend is the reusable half.

- Source: https://www.dexerto.com/twitch/an-ai-powered-vtuber-is-now-the-most-popular-twitch-streamer-in-the-world-3300052/
- Date: 2026-01
- Confidence: medium
- Runs on device: ios-no

### Character.AI's AvatarFX is offline video generation, not a live avatar — it cannot be a persistent on-screen companion.


AvatarFX is a flow-based diffusion model on a DiT architecture that generates video from an image plus an audio sequence. Character.AI's own post claims distillation to reduce diffusion steps but publishes no latency figure, no resolution, and never claims real-time. It launched in closed beta 2025-04-22 for subscribers; by mid-2025 all users got up to 5 videos per day. It produces clips you watch, not a character that sits on screen and reacts. Announced-then-partially-shipped, and structurally the wrong shape for a reading companion.

- Source: https://blog.character.ai/avatar-fx-cutting-edge-video-generation-by-character-ai/
- Date: 2025-04
- Confidence: high
- Runs on device: server-only

### The regulatory floor moved under companion apps in late 2025: Character.AI banned all under-18 open-ended chat, and Google plus Character.AI settled teen-suicide lawsuits in January 2026.


Character.AI announced the ban on 2025-10-29, effective 2025-11-25, preceded by a temporary two-hour daily cap for minors. Driver: an FTC 6(b) inquiry opened September 2025 into seven AI chatbot companies over child safety, plus multiple wrongful-death and psychological-abuse suits (including a Texas suit involving children aged 11 and 17). Fortune reported on 2026-01-08 that Google and Character.AI agreed to settle. The practical consequence for any new companion product: age gating and a defensible safety story are now table stakes, not polish.

- Source: https://fortune.com/2025/10/29/character-ai-ban-children-teens-chatbots-regulatory-pressure-age-verification-online-harms
- Date: 2025-10-29
- Confidence: high

### Apple rebuilt App Store age ratings with 13+/16+/18+ tiers and now requires AI chatbot features to be counted in the rating, with a hard 2026-01-31 questionnaire deadline.


Apple expanded 4+/9+ with new 13+, 16+ and 18+ tiers and required developers to answer the new age-rating questions for every app by 2026-01-31 or face App Store Connect submission interruptions. Developers must account for "artificial intelligence assistants and chatbot functionality" when evaluating content. The 2025-11-13 guidelines update added 5.1.2(i): "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so," plus new 1.2.1(a) requiring an age-restriction mechanism based on verified or declared age. Guidelines were updated again 2026-06-08 with new language on safety and AI. The enforcement gap is real but shrinking — Grok shipped Ani at a 12+ rating ("Infrequent / Mild Mature / Suggestive Themes") with explicit content unlocked at relationship level 3, and drew a public campaign against it.

- Source: https://developer.apple.com/news/?id=ey6d8onl
- Date: 2025-11-13
- Confidence: high

### China's largest AI app, Doubao (172M MAU / >100M DAU), ships no persistent on-screen character — and the viral 'Doubao desktop pet' wave of July 2026 is user-generated Windows EXEs, not a product feature.


Doubao's only avatar is a 3D cartoon girl logo. Per QuestMobile Q3-2025/year-end data it leads Chinese AI apps at 172M MAU with DAU over 100M. The 桌宠 phenomenon that swept Chinese social media in July 2026 works like this: in the Windows Doubao client you switch to 办公任务Turbo mode, grant 本地电脑 permission, upload a transparent PNG, and Doubao writes Python and packages a standalone EXE — borderless transparent always-on-top window, drag, click-to-jump, Chinese speech bubble, right-click resize. Windows 10/11 only, no macOS, no iOS, and not an official Doubao capability. ByteDance's character product 猫箱 (Beijing Chuntian Zhiyun, on Doubao/云雀 models) is text-and-voice roleplay with static portraits — I found no evidence of Live2D animation in it.

- Source: https://www.aitop100.cn/infomation/details/34322.html
- Date: 2026-07
- Confidence: medium
- Runs on device: ios-no

### Chinese realtime voice ships at 650 ms median end-to-end and roughly 1 s — and none of it is attached to an animated character.


Agora's engineering writeup on Zhipu's 智谱清言 video-call assistant reports "中位延迟仅为约650毫秒" measured from end of user speech to start of AI reply. Architecture: GLM-4-Voice encoding speech to 12.5 Hz low-bitrate tokens, GLM-4V-Plus for video understanding, flow-matching TTS that streams from ~10 audio tokens, built on Agora SD-RTN across 200+ countries; built-in VAD, noise suppression, and barge-in interruption; stable at up to 80% packet loss. 清言 has 25M+ cumulative users and the video-call feature pushed consumer annualized revenue past ¥10M. ByteDance's Doubao realtime voice (launched 2025-01-20, full rollout in the Doubao app) claims end-to-end response "低至1秒" over Volcano Engine RTC/WebRTC. Neither product puts a face on it.

- Source: https://www.shengwang.cn/blog/blogdetail/ai-video-call-assistant/
- Date: 2025
- Confidence: high
- Runs on device: server-only

### Platform risk for companion apps is concrete: MiniMax's Talkie was pulled from the US App Store on 2024-12-17 while it was a top-5 US download, and returned only as a renamed app.


Talkie (MiniMax's international build of 星野/Glow) was removed from the US iOS App Store on 2024-12-17 for unspecified "technical reasons", amid privacy and national-security scrutiny of Chinese-owned apps. Before removal it was the fourth-most-downloaded app in the US in H1 2024 with 3.8M US downloads, ahead of Character.AI at #10. It stayed on Google Play throughout and reappeared in February 2025 under the name Talkie Lab. A companion app's distribution can vanish overnight independent of product quality.

- Source: https://www.scmp.com/tech/tech-trends/article/3291715/chinese-owned-characterai-rival-vanishes-us-app-store
- Date: 2024-12
- Confidence: medium

### Every standalone hardware companion of this cycle failed, and Gatebox — the original holographic character companion — is dead.


Gatebox's Azuma Hikari was discontinued in August 2024 and the GTBX-100JP mass-production unit is discontinued with no restock; the chat function was folded into ChatGPT in May 2025. Friend spent over $1M on ~11,000 NYC subway ads in 2025, drew vandalism reading "AI is not your friend", and by that fall had sold ~3,000 units, shipped ~1,000, and booked ~$348,000 revenue; it relaunched 2026-07-31 at $249 with a speaker and a subscription. Rabbit r1 sold 100,000 units and had roughly 5,000 active users five months after launch — 95% abandonment — though as of August 2026 the company still ships firmware. Humane's AI Pin is dead.

- Source: https://www.cnn.com/2025/11/16/tech/friend-ai-device-backlash-ceo-avi-schiffmann
- Date: 2025-11-16
- Confidence: medium

### The companion hardware that actually sells deliberately does not talk — Moflin, LOVOT and aibo communicate through sound and movement, and China's best-selling AI companion toy hit ~300,000 units on that model.


Casio's Moflin launched in the US on October 1 at $429, learns your voice and develops distinct attachment behaviours per unit; Casio targeted 7,000 units in UK+US by end of March 2026 and ~$34M globally over three to five years. Moflin, LOVOT (Groove X) and Sony aibo all communicate through sounds and movement, not words. Robopoet's 芙崽 Fuzozo launched in China in June 2025, passed 120,000 units in under six months, won the AI-toy category on Tmall and JD during Double Eleven 2025, and reached nearly 300,000 cumulative domestic units by June 2026 with 80% female users who call themselves "Fuzozo parents". The proactive-speech products in this category are the outliers: ElliQ reaches out rather than waiting for a command.

- Source: https://sherwood.news/business/casio-now-selling-furry-ai-powered-pet-robot-bets-on-loneliness/
- Date: 2025-10
- Confidence: medium

### Companion-app economics are winner-take-most and the healthiest new entrant, Tolan, wins with a stylized non-human character driven by IK procedurals plus keyframes in a state machine — not with realism.


Appfigures: AI companion apps generated ~$120M consumer spend in 2025 across 220M cumulative downloads and 337 revenue-generating apps; revenue per download rose from $0.52 (2024) to $1.18 (2025); the top 10% of apps captured 89% of category revenue, and ~33 apps passed $1M lifetime. Tolan (Portola) took $10M seed in Feb 2025 and a $20M Series A led by Khosla, with 3M+ downloads, 100k+ paid users and >$1M/month revenue. Its character is explicitly non-human and abstract, animated with "a mixture of inverse kinematic-driven procedurals, and thoughtfully constructed natural keyframes" in "a state machine of keyframe and procedural animations" — a design chosen precisely because multimodal models couldn't yet drive emotion in real time. It initiates: daily check-ins, proactive topic suggestions, mindfulness prompts, reactions to uploaded photos. Meanwhile Replika, the realism-and-3D-avatar incumbent, is estimated at $4.8M ARR in 2026 down from $14M in 2024.

- Source: https://www.tolans.com/relay/designing-tolan-part-1-characters
- Date: 2025
- Confidence: medium
- Runs on device: ios-yes

## Numbers

### Animation Inc on-device motion model inference speed (the engine behind Grok's Ani)

- Value: 2.5 ms/frame
- Source: https://www.animation.inc/

### Duolingo Lily Rive character file size

- Value: under 1 MB (8 head × 8 body = 64+ variations)
- Source: https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life

### Rive web runtime size, brotli -9 compressed

- Value: canvas-lite 222 KB / canvas 567 KB / webgl2 648 KB
- Source: https://rive.app/docs/runtimes/runtime-sizes.md

### Rive native Apple runtime size impact

- Value: ~1.67 MB download, ~4.66 MB install
- Source: https://rive.app/docs/runtimes/runtime-sizes.md

### Live2D Publication License fee for entities under ¥10M annual sales

- Value: ¥0 (free), on both one-time and running-royalty plans
- Source: https://www.live2d.com/en/sdk/license/running_plan01/

### Live2D running-royalty fee, Middle-Scale Enterprise

- Value: ¥50,000 initial per region + ¥20,000/month per platform per region
- Source: https://www.live2d.com/en/sdk/license/running_plan01/

### Live2D running-royalty fee, Large-Scale Enterprise

- Value: ¥300,000 initial per region + ¥100,000/month per platform per region
- Source: https://www.live2d.com/en/sdk/license/running_plan01/

### Live2D Cubism Editor FREE version hard caps (file will not save beyond)

- Value: 30 parameters, 30 parts, 100 ArtMeshes
- Source: https://www.live2d.com/en/cubism/comparison/

### Live2D Cubism PRO indie annual subscription

- Value: ¥14,280/year
- Source: https://note.com/live2dnote/n/n650a79713699

### Zhipu 清言 video-call assistant end-to-end voice latency (median)

- Value: ~650 ms
- Source: https://www.shengwang.cn/blog/blogdetail/ai-video-call-assistant/

### Doubao realtime voice end-to-end response over Volcano Engine RTC

- Value: as low as 1 s
- Source: https://www.volcengine.com/docs/6360/1330208

### Grok Companions platform and price before retirement

- Value: iOS only, $30/month (SuperGrok)
- Source: https://www.roborhythms.com/grok-companions-discontinued/

### Grok Ani launch-week monetization

- Value: downloads +40% to 171,000/day, revenue +9% to $337,000
- Source: https://www.roborhythms.com/grok-companions-discontinued/

### Animates (Animation Inc's own companion app) iOS bundle size

- Value: 472.1 MB, iOS 18.0+, 18+ rating, ships 2026-09-11
- Source: https://apps.apple.com/us/app/animates-life-companions/id6758621319

### Animates subscription tiers

- Value: $7.99 / $19.99 / $39.99 per month (annual $63.99 / $159.99 / $319.99)
- Source: https://apps.apple.com/us/app/animates-life-companions/id6758621319

### AOi (shipped iOS Live2D character-AI app, Supergene Inc) bundle size

- Value: 192.5 MB, iOS 16.2+, iPhone only, 4.6★ / 635 ratings
- Source: https://apps.apple.com/jp/app/aoi-live2d-%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC-ai/id6451235944

### Neuro-sama active Twitch subscribers (2026-01-02), #1 on the platform

- Value: 162,459 (vs 73,942 for #2 Jynxzi); ~$400,000/month from subs
- Source: https://www.dexerto.com/twitch/an-ai-powered-vtuber-is-now-the-most-popular-twitch-streamer-in-the-world-3300052/

### AI companion app category, 2025

- Value: $120M consumer spend, 220M cumulative downloads, 337 revenue-generating apps; top 10% take 89% of revenue
- Source: https://companionrater.com/ai-companion-statistics-2026

### AI companion revenue per download

- Value: $0.52 (2024) → $1.18 (2025)
- Source: https://companionrater.com/ai-companion-statistics-2026

### Tolan (Portola) traction

- Value: $30M raised, 3M+ downloads, 100k+ paid users, >$1M/month revenue
- Source: https://www.geekwire.com/2025/ai-companionship-app-tolan-raises-20m-to-help-more-people-grow-with-a-virtual-alien-friend/

### Replika estimated ARR

- Value: $4.8M (2026) down from $14M (2024); valuation $41.9M
- Source: https://getlatka.com/companies/replika.ai

### Friend AI pendant: ad spend vs revenue

- Value: $1M+ on ~11,000 subway ads; ~3,000 units sold, ~1,000 shipped, ~$348,000 revenue; relaunched at $249
- Source: https://www.cnn.com/2025/11/16/tech/friend-ai-device-backlash-ceo-avi-schiffmann

### Rabbit r1 abandonment

- Value: 100,000 units sold, ~5,000 active users after 5 months (95%)
- Source: https://www.statista.com/statistics/1452333/rabbit-r1-unit-sales/

### Casio Moflin price and target

- Value: $429; 7,000 units UK+US by March 2026; ~$34M globally over 3-5 years
- Source: https://sherwood.news/business/casio-now-selling-furry-ai-powered-pet-robot-bets-on-loneliness/

### 芙崽 Fuzozo cumulative China sales

- Value: ~300,000 units by June 2026 (120,000 in first 6 months); 80% female users
- Source: https://zhuanlan.zhihu.com/p/1997831366407115290

### Doubao scale (QuestMobile, Q3 2025 / year-end)

- Value: 172M MAU, >100M DAU — and no persistent on-screen character
- Source: https://zh.wikipedia.org/zh-cn/%E8%B1%86%E5%8C%85_(%E8%81%8A%E5%A4%A9%E6%9C%BA%E5%99%A8%E4%BA%BA)

### OpenAI gpt-realtime audio token pricing (per 1M tokens, in/out)

- Value: $32 / $64 flagship; $10 / $20 for gpt-realtime-2.1-mini; cached input $0.40
- Source: https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions

### OpenAI Realtime effective cost per conversation minute (July 2026, measured)

- Value: $0.06-0.11/min flagship, $0.02-0.05/min mini with prompt caching
- Source: https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions

### Realtime audio tokenization rate

- Value: user 1 token/100 ms (600 tokens/min); assistant 1 token/50 ms (1,200 tokens/min)
- Source: https://hackernoon.com/openai-realtime-api-pricing-in-2026-real-world-data-from-4000-measured-sessions

### Apple age-rating questionnaire deadline; new tiers

- Value: 2026-01-31 deadline; 13+, 16+, 18+ added to 4+/9+
- Source: https://developer.apple.com/news/?id=ks775ehf

### WebGPU availability on iOS

- Value: ships in Safari 26.0 on iOS 26 / iPadOS 26, September 2025
- Source: https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/

## Fact-check

### 2. Ani's rendering came from Animation Inc (not built by xAI); on-device model at 2.5ms/frame, native-SDK-only, no web runtime, no published pricing

- Verdict: **refuted**

Correction: The technical specs of Animation Inc's own product (2.5ms/frame, platform list, team size/location) check out against animation.inc directly. The claim that this company built Ani for xAI/Grok is unsubstantiated -- no primary or secondary source ties the two together. Also unverifiable from the cited URL: Animates app release date (2026-09-11), file size (472.1MB), age rating, and $7.99/$19.99/$39.99 pricing tiers (not present on animation.inc; the App Store listing URL I tried 404'd), and the MSQRD/Loona founder-pedigree claim (not on the page fetched).

Evidence: animation.inc (fetched directly) confirms its own technical claims -- 'proprietary on-device AI model generates full-body 3D motion in real-time,' 'Inference speed: 2.5 ms/frame,' platforms iOS/Android/Mac/Windows (no Web listed), team of 13 in Warsaw/Limassol/Palo Alto. BUT the page contains NO mention of Ani, Grok, or xAI anywhere. I ran targeted Google News RSS searches for 'Animation Inc Ani Grok xAI' and 'Animation Inc Animates Warsaw MSQRD Loona' and found zero articles connecting this company to xAI's Ani character at all -- only unrelated Grok launch coverage. The central linking claim of the whole item ('it came from Animation Inc') has no support anywhere I could find; it appears to be an unsourced inference presented as established fact.

### 5. Live2D Cubism SDK for Web officially supports Safari on iOS, and the license is free under ¥10M annual sales

- Verdict: **corrected**

Correction: Live2D's own compatibility table lists Safari as supported on macOS only, NOT iOS -- 'officially supports Safari on iOS' is false per the primary source. (Chrome/Firefox/Edge on iOS are listed as supported, but for a WKWebView-embedded app this Safari-specific gap matters.) All license/pricing figures in the claim and in N5-N9 are independently confirmed correct.

Evidence: Live2D's own SDK support page (live2d.com/en/sdk/about/, fetched directly) shows a compatibility table where Safari is marked supported on macOS only ('Safari – – ○ –') and explicitly NOT marked for iOS, while Chrome/Firefox/Edge ARE marked supported on iOS. This directly contradicts 'officially supports Safari on iOS.' The license-fee claims, however, all check out: live2d.com/en/sdk/license/running_plan01/ and /purchase_plan01/ /purchase_plan02/ confirm General User and Small-Scale Enterprise (<¥10M annual sales) pay ¥0 on both the one-time-purchase and running-royalty plans; Middle-Scale ¥100,000 one-time or ¥40/unit; running-royalty Middle ¥50,000+¥20,000/mo, Large ¥300,000+¥100,000/mo (confirmed via the page's own USD-converted figures: $314.45/$125.78 and $1,886.70/$628.90, which back-convert to those yen amounts). live2d.com/en/cubism/comparison/ confirms FREE editor caps at 30 parameters/30 parts/100 ArtMeshes with 'you will not be able to save the file' beyond that; note.com/live2dnote/n/n650a79713699 confirms PRO indie annual ¥14,280.

### N12. Grok Companions platform and price before retirement = iOS only, $30/month (SuperGrok)

- Verdict: **corrected**

Correction: Price ($30/month base SuperGrok tier) is supported. 'iOS only' is disputed even by the cited source, which flags a reported (if contested) spring-2026 Android rollout.

Evidence: roborhythms.com/grok-companions-discontinued/ confirms the $30/month SuperGrok price (and mentions some users on $300/month SuperGrok Heavy). But the same page explicitly notes 'Android rollout reportedly occurred spring 2026, though documentation disputed this' -- i.e. the source itself does not support a clean 'iOS only' claim.

## Dead ends

- Animation Inc's SDK (the actual engine behind Grok's Ani): native iOS/Android/Mac/Windows only, no web/WASM runtime, no published pricing — unreachable from a Tauri WebView without abandoning the WebView architecture.
- Copying Grok Companions' 3D-anime approach: xAI itself retired it on 2026-07-24 after launch-week data showed downloads +40% but revenue only +9%.
- AvatarFX-style generated video avatars (Character.AI): flow-diffusion offline generation capped at 5 videos/day, never claimed real-time — structurally cannot be a persistent on-screen character.
- Waiting for a first-party persistent character from Apple or Google: WWDC 2026 'Siri AI' has no avatar on iPhone (only a 3D visualization on visionOS), and Google's Gemini Avatar is a likeness/video-clip feature, not a companion.
- Unreal Engine for the character: Live2D's Unreal SDK is Windows-only; and any game-engine route (Unity/Unreal) means replacing your React/WebView shell.
- Porting Open-LLM-VTuber (MIT, 13.5k stars): its Live2D web frontend is reusable, but the whole runtime is a Python backend on Windows/macOS/Linux with no iOS build.
- Doubao-style 'desktop pet' as a reference implementation: it is AI-generated Python packaged into a Windows 10/11 EXE by users, not a product feature, and there is no iOS equivalent.
- Hardware companion as the presence layer: Gatebox's Hikari discontinued August 2024, Humane AI Pin dead, Rabbit r1 at 95% abandonment, Friend at ~$348k revenue against $1M+ of subway ads.
- Letting users load their own Live2D models: that makes the app an 'Expandable Application', which is explicitly excluded from Live2D's small-business fee exemption.
- Photorealism as a route to 'close to a real person': Replika is the realism incumbent and its estimated ARR fell from $14M (2024) to $4.8M (2026), while stylized non-human Tolan crossed $1M/month.

## Open questions

- No measured voice latency was ever published for Grok's Ani specifically. The 0.78 s time-to-first-audio figure circulating belongs to the separate Grok Voice Agent API, not the companion feature.
- Animation Inc's SDK availability, platform list, pricing, model size and memory footprint are all unpublished; their SDK usage policy page discloses none of it. Contacting them directly is the only way to learn the terms.
- No published fps, CPU, GPU or battery measurements for either Rive or Live2D Cubism Web running inside WKWebView on an iPad. Live2D's own docs only warn that 'execution performance depends on device capabilities'. This needs to be measured on target hardware before committing.
- Live2D officially lists Safari on iOS for the Web SDK but says nothing about WKWebView specifically; whether a Tauri iOS webview inherits that support is untested here.
- No teardown of how Ani's assets were packaged or how large the on-device model was — the CGTrader listings of 'Grok Ani' models are third-party recreations, not extracted originals.
- MAU figures for the Chinese companion apps specifically (星野, 猫箱) could not be retrieved — the session's web-search budget was exhausted (200/200) before that query ran.
- Whether 猫箱 uses any animated (Live2D) portrait at all, versus static character art, is unresolved; sources describe only text/voice interaction and an '情绪共振' response-tone algorithm.
- Retention curves for character-bearing vs character-less AI apps could not be isolated. The only comparables found are Replika's claimed 45% D30 (self-reported, via a secondary estimate site) against a 5-7% D30 cross-category median.

## Unverifiable

- 1. xAI retired 3D animated Companions on 2026-07-24, statement wording and staggered rollout, personalities kept as prompt layers, launch-week download/revenue numbers ($337K rev / 171K downloads, +40%/+9%)
- N11. Doubao realtime voice end-to-end response over Volcano Engine RTC = as low as 1s
