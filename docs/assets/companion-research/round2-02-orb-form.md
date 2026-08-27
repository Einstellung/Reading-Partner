# Round 2 / 2 — orb 形态

> 第二轮调研，2026-08-27 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度：orb-form

---

## Headline

The orb is the shipped consensus and it carries 5–7 system states, never 8 emotions — but in the last 10 months both Microsoft and OpenAI deleted their dedicated voice visual, and the persistent-orb case rests on a comprehension number that does not appear to exist.

## Verdict

Drop the character. The evidence for that is not aesthetic, it is two obituaries: Microsoft retired Mico — an amorphous, color-shifting, deliberately non-human blob, shipped optional-by-default with an off switch — on 2026-08-13, ten months after launching it, and OpenAI removed the blue orb screen as the default on 2025-11-25, demoting it to a legacy "Separate Mode" toggle that its current help page no longer even mentions. But adopt the orb for what it actually is in every shipped product: a five-to-seven-state system indicator (idle / connecting / listening / thinking / speaking / error), not a compressed emotional register. Nothing found expresses eight distinguishable affective states through an abstract shape; Alexa, after ten years, runs its entire conversational loop in one color and distinguishes listening / thinking / responding by motion type alone, spending a hue only when it leaves the conversation. The attachment worry is misplaced — the Roomba study is direct evidence that a non-lifelike form engenders strong attachment, and it names the mechanism as movement variability rather than a face, which an orb can have. The persistence question, however, should not be argued from the "~28% comprehension" figure: the 2024 eye-tracking study matching that description found no significant effect on comprehension at all, and the real negative finding is a 2015 study of nine-year-olds with no percentage attached. The binding constraint on a persistent orb is WCAG 2.2.2 Pause/Stop/Hide (Level A), which a breathing shape beside a page of text triggers exactly, so it needs an off switch regardless. On implementation, 10 Hz is not "steppy" — lerped at 60 fps with the industry-standard constants it reads as flattened and roughly 100 ms late, because the speech envelope peaks at 4–5 Hz and 10 Hz is precisely Nyquist; everyone else feeds ~30 Hz, and raising the Swift emit rate is a one-line change, so do not design around 10 Hz. Finally, since this project's entire audio chain already lives in Swift, drawing the orb in Swift (metasidd/Orb is MIT, iOS 17+, 443 stars) skips the level bridge into the WebView altogether.

## Findings

### Microsoft retired Mico — the closest existing product to the abandoned character design — on 2026-08-13, ten months after shipping it


Mico arrived in the Copilot Fall Release (Oct 2025) described by Microsoft as "expressive, customizable, and warm", an optional presence that "listens, reacts, and even changes colors to reflect your interactions." GeekWire: "Less than a year later, Microsoft is pulling Mico from Copilot's core voice experience as part of the merger of the Copilot consumer and business apps." It survives only in Copilot's education/Learn Live surface. GeekWire frames it as the successor to Bob, Clippy and Cortana, and ties it to a leadership change: Mustafa Suleyman's bet that "the way to win users away from ChatGPT was warmth and personality, not just raw capability"; in March 2026 Copilot oversight went to Jacob Andreou (ex-Snap), who told his org in July that Copilot should focus on "real work" and be "optimized for outcomes."

- Source: https://www.geekwire.com/2026/farewell-mico-microsofts-cute-little-ai-blob-is-going-the-way-of-bob/
- Date: 2026-08-13
- Confidence: high

### Mico was already opt-out-able on day one because Microsoft anticipated it would be distracting


Contemporary description: "Mico is an optional visual layer for Copilot's voice mode. It's not a photorealistic avatar — it's an abstract, animated presence designed to convey listening, emotion, and responsiveness in a lightweight way." Key characteristics listed: "Expressive but minimal: simple animations, color shifts, and shape changes rather than humanlike faces"; "Voice-mode centric: appears by default during Copilot voice sessions unless the user opts out"; "Customizable and optional: users can disable the avatar if they find it distracting." So the shipped design was already the halfway house between a character and an orb — and it still died.

- Source: https://windowsforum.com/windows-news.4/mico-microsofts-expressive-copilot-avatar-for-voice-on-windows.386271/
- Date: 2025-10-24
- Confidence: high

### OpenAI demoted the blue orb screen from default to legacy toggle on 2025-11-25


OpenAI: "You can now use ChatGPT Voice right inside chat—no separate mode needed. You can talk, watch answers appear, review earlier messages, and see visuals like images or maps in real time." The previous full-screen blue orb is retrievable via Settings → Voice → Separate Mode. An OpenAI help-page snapshot indexed later read: "ChatGPT voice can appear as either an voice experience inside the main chat page chat or separate mode (the blue orb screen). Most users on iOS and Android will see the integrated experience by default." The orb was replaced in the default path by a waveform icon plus a live transcript.

- Source: https://www.thurrott.com/a-i/330108/chatgpts-voice-mode-is-now-built-into-chat-conversations
- Date: 2025-11-25
- Confidence: high

### OpenAI's current ChatGPT Voice documentation does not mention the orb at all


I fetched help.openai.com/en/articles/8400625-voice-mode-faq, which now redirects to /articles/20001274-chatgpt-voice, marked "Updated: 11 days ago" (≈2026-08-16). Full page text is 18,255 characters and contains zero occurrences of "orb", "blue", or "separate mode". The page describes three options (Live / Advanced / Standard, Live powered by GPT-Live-1) purely in behavioral terms. The orb has been written out of OpenAI's own product description. Negative finding, verified by string search of the live page.

- Source: https://help.openai.com/en/articles/20001274-chatgpt-voice
- Date: 2026-08-16
- Confidence: high

### Apple moved the same direction: bottom orb → screen-edge glow (iOS 18) → a dedicated Siri chat app (WWDC26)


iOS 18 with Apple Intelligence replaced the bottom-of-screen shimmering orb with a colored glow around the screen edge; without Apple Intelligence enabled the legacy orb persists, which is why users kept reporting the glow "reverting". At WWDC26 Apple announced: "A dedicated Siri app allows users to revisit a past conversation or kick off a new one — all in one place — and uses iCloud to privately sync conversational history across a user's products." The 2026-06-08 newsroom release describes Siri's capabilities at length and says nothing whatsoever about an orb, glow, animation, or visual identity.

- Source: https://www.apple.com/newsroom/2026/06/apple-unveils-next-generation-of-apple-intelligence-siri-ai-and-more/
- Date: 2026-06-08
- Confidence: medium

### Alexa's ten years of hard-won design: motion carries the conversational loop, color carries everything else


Amazon's own brand guidelines define 12 light ring states. Primary functionality is three states, all blue, distinguished only by motion: Listening = "Directional blue", Thinking = "Alternating blue", Responding = "Pulsing blue". The other nine each buy their distinctness from a hue change, not a motion change: Setup = cycling orange, Mic muted = solid red, Notification = pulsing yellow, Incoming call = pulsing green, Active call = cycling green, Volume = contextual white, Error = quickly pulsing purple, Do not disturb = slowly pulsing purple, Away mode = cycling white. Note that Error and Do-not-disturb share a hue and are separated only by pulse rate — the one place Amazon reuses a color, it uses the crudest possible motion difference (fast vs slow).

- Source: https://developer.amazon.com/en-US/alexa/branding/alexa-guidelines/brand-guidelines/light-ring
- Date: 2026-08-27
- Confidence: high

### Every orb implementation converges on 5–7 states, and not one of them is an emotion


orb-ui (React, adapters for Vapi/ElevenLabs/LiveKit/Pipecat/OpenAI Realtime/Gemini Live): idle, connecting, listening, thinking, speaking, error, waitingForInput. VoiceOrbs gallery (14 orbs, CSS/SVG/Canvas/WebGL): "All orbs share states (idle, connecting, listening, thinking, speaking)." SmoothUI Siri Orb: idle, listening, thinking, streaming, done, error. localmode.ai Voice Orb: idle, connecting, listening, thinking, speaking, muted. aguscruiz/voiceorb: Idle, Listening, Thinking, Speaking. openai-realtime-blocks ChatGPT clone: thinking, responding, volume, idle. fwdtools snippet: idle → listening → thinking → speaking. The de-facto vocabulary is conversational plumbing, not affect. Against the abandoned design's 8 emotions, the orb form does not compress the emotional register — it deletes it.

- Source: https://orb-ui.com/docs/adapters/gemini-live
- Date: 2026-07-22
- Confidence: high

### The one paper that directly tests affect through abstract shape works in 2 dimensions, not 8 labels


Betella, Inderbitzin, Bernardet, Verschure, "Non-anthropomorphic Expression of Affective States through Parametrized Abstract Motifs", ACII 2013, pp. 435–441, DOI 10.1109/ACII.2013.78. From the abstract: "We asked the participants to assess the emotions attributed to these abstract visual cues. Our findings suggest that it is not only possible to express affective states, but also to modulate human behavior through non-anthropomorphic and abstract stimuli." The demonstrated capability is that abstract motion carries affect at all — I found no study establishing how many labeled emotions an abstract shape can carry before confusion, and no confusion matrix for 8 states.

- Source: https://dblp.org/search?q=Non-anthropomorphic+Expression+of+Affective+States
- Date: 2013-09-02
- Confidence: medium

### Apple's own robotics research says the expressiveness of a non-anthropomorphic form comes from movement, not features


ELEGNT: Expressive and Functional Movement Design for Non-anthropomorphic Robot (Yuhan Hu, Peide Huang, Mouli Sivapurapu, Jian Zhang; arXiv 2501.12493). A lamp-shaped robot, no face. Across six scenarios, "expression-driven movements significantly enhance user engagement and perceived robot qualities", most pronounced in social-oriented tasks, without sacrificing task performance. The framework combines "functional and expressive utilities during movement generation." This is the transferable design lever for an orb: expressiveness is bought by making the motion itself intentional, not by adding channels.

- Source: https://arxiv.org/abs/2501.12493
- Date: 2025-01-21
- Confidence: high

### People form strong attachment to non-figurative agents, and the mechanism is movement variability, not a face


Sung, Guo, Grinter, Christensen, "My Roomba Is Rambo: Intimate Home Appliances", UbiComp 2007. Of 30 households: 21 named the robot, 18 "felt that Roomba had intentions, feelings, and unique characteristics", 16 used gendered pronouns, 3 listed the Roomba (with name and age) as a household member on the demographics form, and 27 modified their home for it. The paper states directly: "we complement but extend this research by showing that a non-lifelike form can also engender strong attachment." On mechanism: "Most of our participants latched onto the randomness of Roomba's movement — generated by an algorithm designed to promote Roomba's passage across all sections of the space being cleaned — as being something that triggered an expression of personality." The Roomba has no eyes, no gaze, and "None of these sounds are human (taking the form of beeps instead)." It also records the inverse: one participant's wife refused a Sony AIBO because she "felt much more comfortable with non-lifelike robotic forms."

- Source: https://faculty.cc.gatech.edu/~hic/hic-papers/Roomba-Ubicomp.pdf
- Date: 2007-09-16
- Confidence: high

### NEGATIVE FINDING: the "2024 eye-tracking study, irrelevant animation cut comprehension ~28%" does not check out


The 2024 study matching that description is Ronconi, Mason, Manzione, Schüler, "Effects of Digital Reading With On-Screen Distractions: An Eye-Tracking Study", Journal of Computer Assisted Learning, published online 2024-12-19, N=54 university students, within-participant design, distractions = advertisements and social media notifications. Its result is the opposite of the claim: participants "devoted minimal time to fixating on distractions", "no significant main effect of distractions emerged for immediate text processing", and "Perception of cognitive load and text comprehension were not affected by distractions either." The authors conclude that "simple, static and very usual on-screen distractions during reading do not seem particularly harmful for university students' processing and comprehension of expository texts." No ~28% figure appears anywhere in the literature I could reach. Do not build the anti-persistence argument on this number.

- Source: https://www.research.unipd.it/handle/11577/3543984
- Date: 2024-12-19
- Confidence: high

### The real animation-harms-reading finding is older, about children, and reports no percentage


An eye-tracking experiment on authentic web pages with 59 third-graders (9-year-olds), Journal of Eye Movement Research 8(4), 2015: "Animated adverts had a significant negative effect on children's text comprehension", with effects on fixation duration and regressive saccades, stronger among children with poor gaze control. No effect-size percentage is stated in the abstract. Separately, a 2025 study (Applied Cognitive Psychology, 10.1002/acp.70016, 2025-01-02) does compare static image vs flashing text vs video ads on reading eye movements, but I was blocked from its results by Cloudflare. The honest summary: animation next to text plausibly hurts, the evidence is thin and population-specific, and the specific number in circulation is unsourced.

- Source: https://www.humanrights.lu.se/helena-sandberg/publication/2f0d7956-77f6-416c-9359-e62b8d845df9
- Date: 2015-12-01
- Confidence: high

### The hard constraint on a persistent orb is WCAG 2.2.2 Pause, Stop, Hide — Level A, not AA


For moving, blinking, or scrolling content that "starts automatically, lasts more than five seconds, and is presented in parallel with other content", there must be "a mechanism for the user to pause, stop, or hide it unless the movement, blinking, or scrolling is part of an activity where it is essential." A breathing orb beside a page of reading text meets every clause of the trigger and fails the "essential" exception. The rationale names the affected group explicitly: "certain groups, particularly those with attention deficit disorders, find blinking content distracting, making it difficult for them to concentrate on other parts of the web page", and it also flags "anyone who has trouble reading stationary text quickly." A persistent orb therefore needs an off switch as a matter of conformance, independent of any comprehension study.

- Source: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Date: 2023-10-05
- Confidence: high

### No shipped product puts an audio-reactive abstract shape persistently on screen during another task


Every audio-reactive orb found is summoned: ChatGPT (voice session only, and now not by default), Gemini Live (sparkle drops in and morphs into a bottom-edge wave on entering Live), Siri (invoked), Mico (voice sessions only, opt-out), and all 14 orbs in the VoiceOrbs gallery plus orb-ui, which model "idle" as a connected-but-quiet conversation state, not a background presence. The persistent counterexamples are not audio-reactive: Doubao's 悬浮球 is a persistent floating ball on Android/desktop but it is "圆形的豆包logo悬浮球" — a static logo launcher parked at the screen edge as an invocation shortcut. Razer Ava is persistently visible but is a gaming companion overlay and reception is reported as split. The pattern is clean: persistent shapes are static launchers; reactive shapes are summoned.

- Source: https://voiceorbs.vercel.app/
- Date: 2026-08-27
- Confidence: medium

### 10 Hz sits exactly at Nyquist for the speech envelope, so the orb will read as flattened and late rather than steppy


David, Gransier, Wouters, "Evaluation of phase-locking to parameterized speech envelopes", Frontiers in Neurology, 2022: "The modulation spectrum of the speech envelope exhibits a prominent peak for slow modulations of 4–5 Hz, which corresponds to the syllable rate in speech." This 4–5 Hz syllabic peak is reported as near-universal across languages. Sampling the envelope at 10 Hz yields exactly two samples per syllable: the syllabic rhythm is representable, but every faster component (consonant onsets, plosive attacks — the transients that read as articulation) aliases. Compounding it, the standard smoothing everyone applies already blurs about one 10 Hz interval: an exponential lerp x += (target−x)·k at 60 fps has a time constant of ≈1/(60k), i.e. ≈139 ms at k=0.12 and ≈67 ms at k=0.25. So the failure mode is not visible stepping, it is a pulse that breathes with the sentence instead of the syllable, arriving ~100 ms late. [The Nyquist framing and the time-constant arithmetic are my analysis; the 4–5 Hz figure is the cited measurement.]

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC9382131/
- Date: 2022-08-01
- Confidence: high

### The reference implementation everyone actually ships polls volume at ~30 Hz, not 10 Hz


LiveKit components-js, the most widely deployed voice-agent UI kit, source-level: useTrackVolume update interval 1000/30 ms (~33 ms, 30 Hz) with fftSize: 32 and smoothingTimeConstant: 0, computing RMS as Math.sqrt(sum(a²)/N)/255 over getByteFrequencyData; useMultibandTrackVolume default 32 ms with fftSize 2048; useAudioWaveform default 20 ms (50 Hz). localmode.ai's Voice Orb goes further and "polls getInputVolume() on every animation frame" (60 Hz). The plugin's existing 10 Hz level event is a third of the floor everyone else uses. Since the event rate is just how often Swift posts, raising it to 25–30 Hz is a one-line change and removes the question entirely.

- Source: https://raw.githubusercontent.com/livekit/components-js/main/packages/react/src/hooks/useTrackVolume.ts
- Date: 2026-08-27
- Confidence: high

### Concrete smoothing constants from three working orb implementations


OrbitingBucket/voice-orb-visualizer (Canvas 2D, 24-vertex organic blob, "optimized for 60fps" via rAF): smoothingTimeConstant 0.8, volumeLerpFactor 0.12, fadeOutMs 1200, fftSize 256|512|1024 (default 512), pointCount 24, forceStrength 1.0. aguscruiz/voiceorb (Three.js + custom GLSL, simplex-noise vertex displacement, fresnel glow): analyser.fftSize = 512, analyser.smoothingTimeConstant = 0.3, audioLevel = sum(dataArray)/N/255 over mid bins 10–40, then per-frame currentScale += (targetScale − currentScale) * smoothing with smoothing = 0.25 when audio-reactive and 0.15 otherwise; thinking state uses a fixed (Math.sin(time*1.5)+1)/2 loop. openai-realtime-blocks ChatGPT clone (Framer Motion): spring stiffness 300 + Math.random()*50, damping 10 + Math.random()*2 per bar (deliberately underdamped and de-synchronised), volume-mode threshold currentVolume > 0.02, and a 500 ms silence timeout before falling back to idle so the state does not chatter. Nobody uses a critically damped spring; the pattern is exponential lerp at rAF, plus a hold timer on state exit.

- Source: https://github.com/OrbitingBucket/voice-orb-visualizer
- Date: 2026-08-27
- Confidence: high

### For a small, possibly-persistent element, CSS beats WebGL on every axis that matters on an iPad


SmoothUI's Siri Orb is "six layered conic gradients animated through a registered --angle property", ~8.9 kB, accepts either a plain number or a Motion MotionValue for amplitude such that "a 60fps audio signal never triggers a re-render", and respects prefers-reduced-motion by disabling rotation and amplitude reactivity. Against that, Three.js is "150KB or more", and on mobile "a scene that runs at 60fps for the first few seconds can drop to 20fps after 30" seconds from GPU thermal throttling; CSS transform/opacity animations "run on the compositor thread" and skip the main thread entirely. One implementation detail worth stealing: LiveKit's BarVisualizer deliberately animates height percentages rather than scale transforms because scale distorts border-radius — relevant if the orb pulses by scaling a rounded shape. [The throttling figure is one practitioner article, not a benchmark I could reproduce.]

- Source: https://adamarant.com/en/blog/webgl-vs-css-animation-when-to-use-each-2026
- Date: 2026-07-07
- Confidence: medium

### There is a mature MIT-licensed SwiftUI orb, which matters because this project's audio already lives in Swift


metasidd/Orb: MIT, 443 stars, 45 forks, iOS 17+/macOS 14+/visionOS 1+, Swift 5.9+. Built from SwiftUI gradients, .blur() and opacity animations — no shaders, no Canvas. Nine configurable properties (backgroundColors, glowColor, particleColor, coreGlowIntensity 0.7–1.5, showBackground/showWavyBlobs/showParticles/showGlowEffects/showShadow, speed 30–90) and eight presets. It has no audio input, so amplitude wiring is yours. xqetsia/VoiceOrb builds on it and adds "distinct color, glow, and motion states to represent an AI agent's behavior". Since docs/33 already routes every audio byte through Swift and never into the WebView, drawing the orb natively means the level signal never has to cross the bridge at all — no 10 Hz event, no serialization, no rAF interpolation. [The architectural recommendation is mine; the repo facts are the source.]

- Source: https://github.com/metasidd/Orb
- Date: 2026-08-27
- Confidence: high

### Google is the only vendor that has published design commentary on its voice visual


design.google's Gemini AI Visual Design writeup: the team "explored several foundational shapes to represent Gemini's 'thinking state'", experimenting with "the iconic four-color dots" and "various Material shapes historically tied to voice and Android's system UI", then "softened and blurred to take on an ethereal quality." Gradients are the primary language, with "sharp, almost opaque leading edges that diffuse at the tail, acting as clear visual pointers." Lead designer Anna Sera Garcia: "We're always considering how to depict our UI in a way that feels optimistic, delightful, playful, yet also sophisticated." And the operative principle: "Movement in Gemini is not merely decorative; it's an essential guiding element." In the product, the Gemini sparkle logo drops in and morphs into a glowing wave anchored to the bottom edge on entering Live — the shape does not float free. No OpenAI design writeup on the orb was found; no page date is given on the Google article.

- Source: https://design.google/library/gemini-ai-visual-design
- Date: 2026-08-27
- Confidence: high

### The published ChatGPT-orb recreations show what it actually takes to look like OpenAI's blob


The most faithful recreation found renders with @shopify/react-native-skia and a custom SKSL fragment shader: "3-octave FBM (fbm3) for large soft fluid shapes and advection fields" plus "5-octave FBM for finer boundary detail in the transition zone", two decorrelated shape layers blended, "a sparse overlay layer (fast speed, high warp, low density) for floating wisps", and "3-color gradient mapping: deep blue -> cyan -> white", driven by a time accumulator with a boost multiplier via react-native-reanimated, over a floating bob and a breathing scale on the container. That is the cost of the ChatGPT look specifically. The cheap end of the same visual family is three absolutely-positioned radial-gradient blobs with 14px blur and mix-blend-mode: screen, drifting on 6s / 7.5s / 9s keyframes with negative delays so they never visibly sync — pure CSS, no audio at all.

- Source: https://adithyavis.github.io/awesome-mobile-app-animations/docs/animations/chatgpt-voice-profiles
- Date: 2026-04-17
- Confidence: high

## Numbers

### Mico's lifespan from launch to retirement

- Value: ~10 months (Oct 2025 → 2026-08-13)
- Source: https://www.geekwire.com/2026/farewell-mico-microsofts-cute-little-ai-blob-is-going-the-way-of-bob/
- Vendor claim: no

### Date OpenAI removed the blue orb screen as the default

- Value: 2025-11-25
- Source: https://www.thurrott.com/a-i/330108/chatgpts-voice-mode-is-now-built-into-chat-conversations
- Vendor claim: no

### Occurrences of "orb" in OpenAI's current ChatGPT Voice help page (18,255 chars, updated ~2026-08-16)

- Value: 0
- Source: https://help.openai.com/en/articles/20001274-chatgpt-voice
- Vendor claim: no

### Alexa light ring states defined by Amazon

- Value: 12 total; 3 conversational (Listening/Thinking/Responding), all blue
- Source: https://developer.amazon.com/en-US/alexa/branding/alexa-guidelines/brand-guidelines/light-ring
- Vendor claim: yes

### State count in orb libraries (orb-ui / VoiceOrbs / SmoothUI / localmode)

- Value: 7 / 5 / 6 / 6 — zero emotions in any
- Source: https://orb-ui.com/docs/adapters/gemini-live
- Vendor claim: yes

### Emotion states in the abandoned character design, for comparison

- Value: 8 emotions + 5 idle animations + energy bar
- Source: https://voiceorbs.vercel.app/
- Vendor claim: no

### Peak of the speech-envelope modulation spectrum (= syllable rate), consistent across languages

- Value: 4–5 Hz
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC9382131/
- Vendor claim: no

### Nyquist rate implied for that envelope, vs the plugin's current level-event rate

- Value: ≥10 Hz required; plugin emits exactly 10 Hz (2 samples/syllable, zero margin)
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC9382131/
- Vendor claim: no

### LiveKit useTrackVolume polling interval / fftSize / smoothingTimeConstant

- Value: 1000/30 ms (30 Hz) / 32 / 0
- Source: https://raw.githubusercontent.com/livekit/components-js/main/packages/react/src/hooks/useTrackVolume.ts
- Vendor claim: no

### LiveKit useMultibandTrackVolume / useAudioWaveform update intervals

- Value: 32 ms (~31 Hz) / 20 ms (50 Hz)
- Source: https://raw.githubusercontent.com/livekit/components-js/main/packages/react/src/hooks/useTrackVolume.ts
- Vendor claim: no

### voice-orb-visualizer smoothing constants (Canvas 2D, 60 fps rAF)

- Value: smoothingTimeConstant 0.8, volumeLerpFactor 0.12/frame, fadeOutMs 1200, fftSize 512, pointCount 24
- Source: https://github.com/OrbitingBucket/voice-orb-visualizer
- Vendor claim: no

### aguscruiz/voiceorb smoothing constants (Three.js + GLSL)

- Value: fftSize 512, smoothingTimeConstant 0.3, per-frame lerp k = 0.25 (audio-reactive) / 0.15 (idle)
- Source: https://raw.githubusercontent.com/aguscruiz/voiceorb/main/app.js
- Vendor claim: no

### Time constant of the standard exponential lerp at 60 fps (my arithmetic: 1/(60k))

- Value: ≈139 ms at k=0.12; ≈67 ms at k=0.25
- Source: https://github.com/OrbitingBucket/voice-orb-visualizer
- Vendor claim: no

### openai-realtime-blocks ChatGPT clone spring + hold timer

- Value: stiffness 300+rand·50, damping 10+rand·2, volume threshold 0.02, 500 ms silence timeout
- Source: https://openai-realtime-blocks.vercel.app/components/chatgpt
- Vendor claim: yes

### Bundle cost: CSS conic-gradient orb vs Three.js

- Value: ~8.9 kB vs "150KB or more"
- Source: https://smoothui.dev/docs/components/siri-orb
- Vendor claim: yes

### WebGL mobile thermal throttling (single practitioner article, not a benchmark)

- Value: 60 fps → 20 fps after ~30 s
- Source: https://adamarant.com/en/blog/webgl-vs-css-animation-when-to-use-each-2026
- Vendor claim: no

### WCAG 2.2.2 Pause, Stop, Hide trigger threshold and conformance level

- Value: more than 5 seconds, in parallel with other content; Level A
- Source: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Vendor claim: no

### Roomba attachment (Sung et al., UbiComp 2007, N=30 households)

- Value: 21/30 named it, 18/30 attributed personality, 16/30 gendered it, 3 listed it as a family member, 27/30 modified their home
- Source: https://faculty.cc.gatech.edu/~hic/hic-papers/Roomba-Ubicomp.pdf
- Vendor claim: no

### Eye-tracking study cited as the ~28% comprehension finding: actual N and result

- Value: N=54; no significant effect on processing, cognitive load, or comprehension
- Source: https://www.research.unipd.it/handle/11577/3543984
- Vendor claim: no

### The study that does find animation harms comprehension

- Value: N=59 third-graders, 2015, significant negative effect, no percentage reported
- Source: https://www.humanrights.lu.se/helena-sandberg/publication/2f0d7956-77f6-416c-9359-e62b8d845df9
- Vendor claim: no

### metasidd/Orb (SwiftUI, MIT)

- Value: 443 stars, 45 forks, iOS 17+, 9 config properties, 8 presets, no audio input
- Source: https://github.com/metasidd/Orb
- Vendor claim: no

## Fact-check

### Claim 1: Microsoft retired Mico on 2026-08-13, ~10 months after its Oct 2025 launch; pulled from Copilot core voice experience as part of consumer/business app merger; survives on education surfaces; framed vs Bob/Clippy/Cortana; tied to Suleyman's warmth bet and Andreou's March 2026 'real work'/'optimized for outcomes' pivot.

- Verdict: **confirmed**

Evidence: Fetched the live GeekWire article via a Wayback Machine mirror (web.archive.org/web/20260825145931/...). Byline 'Todd Bishop, Aug 13, 2026 at 8:28 am'. Verbatim matches: '...described as "expressive, customizable, and warm" — an optional presence that "listens, reacts, and even changes colors to reflect your interactions."' / 'Less than a year later, Microsoft is pulling Mico from Copilot's core voice experience as part of the merger of the Copilot consumer and business apps, announced Thursday morning.' / 'Mico is expected to live on in some of Copilot's education features' / joins 'Bob, Clippy and Cortana' / 'a bet Microsoft made about consumer AI under Mustafa Suleyman... that the way to win users away from ChatGPT was warmth and personality, not just raw capability' / 'In March, Microsoft handed oversight of Copilot to Jacob Andreou, a former Snap executive... Andreou told his organization in July that Copilot should focus on "real work" and be "optimized for outcomes."' One caveat: the article says Mico survives in 'education features' generically -- it never says 'Learn Live' by name, so the claim's specific 'education/Learn Live surface' phrasing is the researcher's own inference, not text from this source (though Learn Live is a real, separately-confirmed Copilot feature). The article also doesn't spell out '2026' after 'In March' -- that year is inferred from context, reasonably.

### Claim 2: Mico was opt-out-able on day one; contemporary WindowsForum description called it 'an optional visual layer... not a photorealistic avatar... abstract, animated presence' with bullets 'Expressive but minimal,' 'Voice-mode centric: appears by default... unless the user opts out,' 'Customizable and optional: ...if they find it distracting.'

- Verdict: **refuted**

Correction: The bullet-point quotes in claim 2 are not present at https://windowsforum.com/windows-news.4/mico-microsofts-expressive-copilot-avatar-for-voice-on-windows.386271/ (verified 2025-10-24 version, full text). If a source for those exact quotes exists, it is not this URL.

Evidence: Fetched the full cited page (title and 2025-10-24 publish date both match) via a text-extraction proxy. None of the quoted phrases appear anywhere on the page -- zero hits for 'optional visual layer,' 'abstract, animated presence,' 'Expressive but minimal,' 'Voice-mode centric,' 'Customizable and optional,' 'photorealistic,' or 'distracting.' The actual article instead calls Mico 'a colorful, expressive orb... a deliberately humanized AI avatar,' and says it 'changes expression, color, and posture to reflect listening, confusion, affirmation, or empathy' -- i.e. it frames Mico as emotionally expressive and human-adjacent, the opposite of the claim's 'abstract... rather than humanlike faces' framing. The article does support the general opt-out fact in different words ('Mico is optional, enabled by default... users can disable the avatar in Copilot settings if they prefer a more minimal interface'), but the specific quoted sentences attributed to this source do not exist on the page.

### Claim 3: OpenAI demoted the blue-orb 'Separate Mode' from default to a Settings toggle on 2025-11-25 (Thurrott); quoted OpenAI text about 'no separate mode needed'; orb replaced by waveform icon + live transcript in the default path.

- Verdict: **corrected**

Correction: Date and core mechanism (orb demoted to a Settings→Voice→Separate Mode toggle) are correct and independently confirmed via OpenAI's own Jan-2026 help page. But the 'OpenAI:' quote and the waveform-icon/live-transcript detail are not supported by the cited Thurrott URL -- Thurrott paraphrases rather than quotes, and never mentions a waveform icon or transcript.

Evidence: Fetched the Thurrott article directly (byline Laurent Giret, 'Nov 25, 2025'). It confirms the core fact: 'Until now, Voice chats were a separate mode showing a blue orb screen, but the new experience will show ChatGPT's answers in real time in the chat window... the previous "Separate Mode" for voice chats will remain available in Settings → Voice → Separate Mode.' However the article is Thurrott's own paraphrase, not a direct quote -- the exact sentence attributed to 'OpenAI:' in the claim ('You can now use ChatGPT Voice right inside chat—no separate mode needed...') does not appear anywhere in this article's text, and the article never mentions a 'waveform icon' or 'live transcript.' A January 2026 Wayback snapshot of OpenAI's own help article (help.openai.com/en/articles/8400625-voice-mode-faq) does independently confirm the underlying mechanism in near-identical language: 'ChatGPT voice can appear as either an voice experience inside the main chat page chat or separate mode (the blue orb screen). Most users on iOS and Android will see the integrated experience by default... You can switch to Separate Mode (or back) in Settings → Voice → Separate Mode.'

### Claim 4: OpenAI's current ChatGPT Voice help page (help.openai.com/en/articles/20001274-chatgpt-voice) contains zero occurrences of 'orb,' 'blue,' or 'separate mode,' and the old 8400625-voice-mode-faq URL now redirects to it.

- Verdict: **confirmed**

Evidence: Directly fetched a Wayback mirror of the live page (2026-08-04 snapshot; direct fetch of help.openai.com returns 403 to this tool). String search of the extracted text: 0 hits for 'orb', 'separate mode', or 'blue'. Page describes Live/Advanced/Standard voice options and 'GPT-Live-1' in purely behavioral terms, matching the claim. Verified the redirect chain directly: web.archive.org's 302 for 8400625-voice-mode-faq resolves to a snapshot whose HTML contains '20001274' and title 'ChatGPT Voice | OpenAI Help Center'. The page's own 'Updated: X days ago' marker was present (4 days ago as of the Aug-4 snapshot; the claim's '11 days ago ≈ 2026-08-16' figure is from a later fetch and is directionally consistent, not contradicted).

### Claim 5: Apple's WWDC26 newsroom release (2026-06-08) announces a dedicated Siri app with iCloud-synced conversation history, and the release itself never mentions orb/glow/animation.

- Verdict: **confirmed**

Evidence: Fetched the release directly. Confirmed quote: 'A dedicated Siri app allows users to revisit a past conversation or kick off a new one — all in one place — and uses iCloud to privately sync conversational history across a user's products.' Confirmed publish date June 8, 2026. Confirmed the page contains no mention of 'orb,' 'glow,' 'animation,' or Siri's visual identity. Note: the claim's opening sentence about iOS 18's bottom-orb-to-screen-edge-glow transition is not covered by this citation (the item cites only the WWDC26 release) -- that part is asserted without its own sourced URL, though it is a widely-documented, uncontested Apple Intelligence UI change.

### Claim 6: Amazon's Alexa brand guidelines define exactly 12 light-ring states, with the 3 primary conversational states (Listening/Thinking/Responding) all blue and distinguished only by motion (Directional/Alternating/Pulsing), while the other 9 use distinct hues, and Error/Do-not-disturb share purple distinguished only by pulse speed.

- Verdict: **confirmed**

Evidence: Fetched developer.amazon.com/en-US/alexa/branding/alexa-guidelines/brand-guidelines/light-ring directly. Confirmed all 12 states and descriptions verbatim: Listening=Directional blue, Thinking=Alternating blue, Responding=Pulsing blue, Setup=Cycling orange, Mic muted=Solid red, Notification=Pulsing yellow, Incoming call=Pulsing green, Active call=Cycling green, Volume=Contextual white, Error=Quickly pulsing purple, Do not disturb=Slowly pulsing purple, Away mode=Cycling white.

### Claim 7: Every surveyed orb implementation converges on 5-7 conversational states and none includes emotion states; orb-ui's Gemini Live adapter doc defines idle/connecting/listening/thinking/speaking/error/waitingForInput and supports Vapi/ElevenLabs/LiveKit/Pipecat/OpenAI Realtime/Gemini Live.

- Verdict: **confirmed**

Evidence: orb-ui.com/docs/adapters/gemini-live fetched directly: state names exactly 'connecting, listening, thinking, speaking, waitingForInput, error, idle' (7 total) -- matches claim exactly. orb-ui.com/docs/adapters confirms all six named integrations (Vapi, ElevenLabs, LiveKit, Pipecat, OpenAI Realtime, Gemini Live) and that it is a React library. Independently verified two of the other cited libraries: voiceorbs.vercel.app (the 'VoiceOrbs gallery') confirmed 14 orbs across CSS/Canvas/SVG/WebGL and shared states 'idle · connecting · listening · thinking · speaking' (5, matching N5); aguscruiz/voiceorb's app.js (fetched from GitHub) confirmed states exactly Idle/Listening/Thinking/Speaking (4). Did not independently verify the SmoothUI Siri Orb (page blocked, 403), localmode.ai's specific Voice Orb sub-page (root page didn't surface it), openai-realtime-blocks, or fwdtools -- those remain unverified but were not contradicted by anything found.

### N1: Mico's lifespan launch-to-retirement ≈ 10 months (Oct 2025 → 2026-08-13).

- Verdict: **confirmed**

Evidence: GeekWire confirms Mico 'arrived last October' (2025) in the Copilot Fall Release and was pulled 2026-08-13 -- roughly 10 months, consistent with the claim.

### N2: Date OpenAI demoted the blue orb screen from default = 2025-11-25.

- Verdict: **confirmed**

Evidence: Thurrott article byline and publish date confirmed as 2025-11-25 ('Nov 25, 2025'), matching the announcement content.

### N3: Occurrences of 'orb' in OpenAI's current ChatGPT Voice help page = 0.

- Verdict: **confirmed**

Evidence: String search of the extracted page text (via Wayback mirror of the live URL) returned zero matches for 'orb', 'blue', and 'separate mode'.

### N4: Alexa light-ring states = 12 total; 3 conversational (Listening/Thinking/Responding), all blue.

- Verdict: **confirmed**

Evidence: Directly verified against developer.amazon.com's own brand guidelines page; all 12 states and their exact color/motion descriptions match.

### N5: State counts in orb libraries -- orb-ui=7, VoiceOrbs=5, SmoothUI=6, localmode=6 -- zero emotions in any.

- Verdict: **confirmed**

Evidence: orb-ui=7 and VoiceOrbs=5 directly and exactly confirmed against their respective pages (orb-ui.com/docs/adapters/gemini-live; voiceorbs.vercel.app). SmoothUI's page returned 403 and localmode.ai's Voice Orb page was not located at the root URL, so those two counts (6 and 6) were not independently verified, though nothing found contradicts them.

### N6: Emotion states in the abandoned character design = 8 emotions + 5 idle animations + energy bar, sourced to voiceorbs.vercel.app.

- Verdict: **refuted**

Correction: The cited URL (https://voiceorbs.vercel.app/) does not contain this information. Whatever it should cite (an internal design spec, GitHub repo of the abandoned character, etc.), it is not this page.

Evidence: Fetched voiceorbs.vercel.app directly. The page is the 14-orb gallery used (correctly) as the source for claim 7 and N5's 'VoiceOrbs' entry -- it contains no mention whatsoever of an 'abandoned character design,' 8 emotions, 5 idle animations, or an energy bar. The '8 emotions + 5 idle animations + energy bar' figure may well be accurate as a description of the abandoned mascot design, but this citation does not support it -- that content is not on the cited page.

### N7: Peak of the speech-envelope modulation spectrum (syllable rate) ≈ 4-5 Hz, consistent across languages.

- Verdict: **confirmed**

Evidence: PMC article (PMC9382131) fetched directly and quotes: 'The modulation spectrum of the speech envelope exhibits a prominent peak for slow modulations of 4–5 Hz, which corresponds to the syllable rate in speech,' presented as an established, cross-language finding.

### N8: Nyquist rate implied by that envelope = ≥10 Hz required; the plugin emits exactly 10 Hz (zero margin), 'presented as measured.'

- Verdict: **corrected**

Correction: N8's Nyquist-rate figure is the researcher's own derivation from N7, not a fact 'measured' in the cited PMC source -- the label '[presented as measured]' overstates its sourcing even though the underlying math is sound.

Evidence: The PMC article states the 4-5 Hz peak but contains no discussion whatsoever of Nyquist rate, sampling frequency, or any signal-processing sampling requirement -- confirmed by direct fetch and targeted query. The '≥10 Hz required' figure is a valid derived calculation (Nyquist minimum = 2× a 4-5 Hz signal = 8-10 Hz), correctly computed from N7's fact, but it is not something the cited source states or measures.

### N9: LiveKit useTrackVolume polling interval / fftSize / smoothingTimeConstant = 1000/30 ms (30 Hz) / 32 / 0.

- Verdict: **confirmed**

Evidence: Fetched the raw source file directly from GitHub (livekit/components-js, useTrackVolume.ts). Confirmed verbatim: default options `{ fftSize: 32, smoothingTimeConstant: 0 }`, and `setInterval(updateVolume, 1000 / 30)`.

### N10: LiveKit useMultibandTrackVolume / useAudioWaveform update intervals = 32 ms (~31 Hz) / 20 ms (50 Hz).

- Verdict: **confirmed**

Evidence: Same source file: `multibandDefaults = { ..., updateInterval: 32, ... }` and `waveformDefaults = { ..., updateInterval: 20, ... }`, matching exactly.

### N11: voice-orb-visualizer (OrbitingBucket) smoothing constants = smoothingTimeConstant 0.8, volumeLerpFactor 0.12/frame, fadeOutMs 1200, fftSize 512, pointCount 24.

- Verdict: **corrected**

Correction: volumeLerpFactor default in the repo is 0.15/frame, not 0.12/frame. Source: https://raw.githubusercontent.com/OrbitingBucket/voice-orb-visualizer/main/src/core/VoiceOrb.ts (DEFAULT_OPTIONS).

Evidence: Fetched the actual source (VoiceOrb.ts) from github.com/OrbitingBucket/voice-orb-visualizer. DEFAULT_OPTIONS confirms: fftSize: 512, smoothingTimeConstant: 0.8, fadeOutMs: 1200, pointCount: 24, fpsLimit: 60, and Canvas 2D rendering (`this.canvas.getContext('2d')`) -- all match. But `volumeLerpFactor: 0.15` (commented 'Slightly faster response'), not 0.12 as claimed.

### N12: aguscruiz/voiceorb smoothing constants = fftSize 512, smoothingTimeConstant 0.3, per-frame lerp k = 0.25 (audio-reactive) / 0.15 (idle).

- Verdict: **confirmed**

Evidence: Fetched raw app.js directly from GitHub. Confirmed: `analyser.fftSize = 512;`, `analyser.smoothingTimeConstant = 0.3;`, and `const smoothing = (isActive && analyser && state.pulsateMode === 'audio-reactive') ? 0.25 : 0.15;`. States confirmed as Idle/Listening/Thinking/Speaking, matching claim 7's description of this same library.

## Risks

- The ~28% comprehension figure appears to be wrong. The 2024 study it matches (Ronconi et al., JCAL, N=54) found no effect at all. If any prior decision leaned on that number, it needs re-deciding on other grounds — WCAG 2.2.2 is the durable argument, not the eye-tracking literature.
- Two of the three largest vendors deleted their dedicated voice visual within the last 10 months (OpenAI 2025-11, Microsoft 2026-08). Building the orb as the product's identity is betting against a live trend; building it as a state indicator inside voice sessions is not.
- Do not assume the orb buys legal cover. SB 243's companion-chatbot duties and China's AI-content labelling rules key on system behavior and outputs, not on whether the UI has a face. Dropping the name and the affection meter may reduce exposure; dropping the illustration probably does not. This is outside what I verified — get it checked separately.
- 10 Hz is not a design constraint, it is a config value. The risk is designing the animation around 10 Hz (over-smoothing, slow envelopes) and then being stuck with a mushy pulse after the rate is raised. Fix the rate first, then tune the lerp.
- If the orb is built in the WebView it needs a level bridge across a boundary that docs/33 deliberately keeps audio-free — one more thing to keep in sync, one more thing to drop frames. If it is built in Swift there is no bridge, but the UI is then split across two rendering systems and the orb cannot be laid out by Tailwind alongside the chat.
- A persistent orb needs an off switch to conform to WCAG 2.2.2 Level A. Microsoft shipped exactly that switch for Mico on day one and still retired the character — an off switch is table stakes, not a mitigation.
- The character's growth/nurture and energy-bar mechanics have no orb equivalent. If any product behavior downstream (usage pacing, token budget visibility) was riding on the energy bar, it loses its surface and needs a replacement decided explicitly rather than dropped silently.

## Open questions

- What rate can the Swift plugin actually sustain for the level event, and what does one post cost? 25–30 Hz matches every reference implementation; the current 10 Hz is a third of that.
- Native Swift orb (metasidd/Orb, no bridge, audio stays where it already is) or WebView orb (one rendering system, but the level signal has to cross a boundary docs/33 keeps audio-free)? This is the actual implementation fork and it should be decided before any pixels.
- Does the orb ever need to be on screen during reading? docs/33 scopes voice to the info-line morning briefing and says reading does not get voice. If that holds, the whole persistent-vs-summoned question is moot and the orb is summoned by definition.
- Which states does this product actually need? Alexa runs the conversation in 3 and reserves color for leaving it. The libraries default to 5–7. Enumerate the real ones (listening, thinking, speaking, plus whatever the briefing needs — 'reading you item 3 of 8'?) before picking a rendering technique.
- Does anything replace the energy bar, or does the token-budget signal move into text/conversation per the existing 'conversation is the correction UI' principle?
- Should idle exist at all? Every library defines an idle state, but in a summoned orb 'idle' means connected-and-quiet, not background presence — and a breathing idle is precisely what trips WCAG 2.2.2.
