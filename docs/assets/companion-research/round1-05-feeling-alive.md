# Round 1 / 5 — 什么让陪伴显得活着

> 第一轮调研，2026-08-26 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度原题：What makes a companion feel alive rather than like a chatbox with a face (design/behavior dimension)

---

## Headline

"Alive" is bought with three cheap always-on loops (blink, breath, gaze-follow) plus sub-second reaction latency, not with intelligence — while the expensive part, proactive speech, is hard-capped by iOS background rules and is the single failure mode that killed Clippy and is measurably destroying the Chinese companion market's retention right now.

## Relevance to this repo

The cheapest 90% of "alive" transfers to this app essentially for free: blink, multi-axis breath, and gaze/touch-follow are three sine-and-random loops with published constants, implementable in a `.ts` module with no React dependency, no Live2D SDK, no licence, and a unit test per loop — the existing rule that non-React logic lives in `.ts` fits this exactly. The second-cheapest win is latency, not intelligence: LOVOT buys attachment with a 0.2–0.4 s reaction and 37 °C of warmth and no language at all, so a sprite that visibly reacts to a highlight or a page turn within ~200 ms in the WebView will read as more alive than one that produces a clever sentence two seconds later. The expensive and genuinely blocked part is proactive speech: on iOS the character cannot decide anything while the app is backgrounded, so the honest design space is (a) reacting in-session while the user reads, which is free, and (b) at most a small number of pre-decided local notifications, which the push-frequency evidence caps at low single digits per week. The voice question has a concrete answer with a cost: a glowing blue sprite paired with a fully human-realistic TTS voice is the mismatch condition that Mitchell measured as eerier and colder than the matched pair, so when the audio stack does get built the target is a stylized, slightly non-human, expressive voice — which is also the cheaper and lower-latency target. Two things in the concept art should change: the energy bar must only fill, never drain while the user is away (Finch's shipped model versus Tamagotchi's abandonment risk), and the eight emotion states should drive a *guiding* character rather than an explaining one, since that is the only agent role the cognitive-load meta-analysis finds a benefit for. Compliance is not optional overhead here: this feature meets SB 243's definition of a companion chatbot with no applicable exclusion, so an "I'm AI, not human" disclosure, a published self-harm/crisis protocol, and — if the app rates 13+ like Tolan — a three-hour break reminder for known minors are build items, alongside the Apple 5.1.2(i) consent flow that is already needed because book pages and annotations go to a third-party LLM. Finally, the strongest counter-argument stands and should be designed around rather than argued away: the one eye-tracked test of animation beside narrative content found a 28% comprehension drop from irrelevant motion and no benefit from relevant motion, so the sprite must be still or off-screen while the user's eyes are on the page, and animate only in the gaps — after a page turn, after a highlight, when the user has stopped scrolling.

## Findings

### On iOS an app cannot decide on its own to speak while backgrounded; proactive speech has exactly three surfaces and the push one is rate-limited by Apple to three per hour.


Apple's own background-strategies doc: BGAppRefreshTask means "the system decides the best time to launch your background task" and grants "up to 30 seconds of background runtime"; for silent background pushes, "If you send background pushes more frequently than three times per hour, the system imposes rate limitations." So the companion can only (a) reason and speak while the app is foregrounded, (b) fire a local notification whose text was decided earlier, or (c) have a server decide and push — with the 3/hour ceiling and a 30-second work budget. Any design that assumes "the pet noticed something and pipes up two hours later on its own" needs a server, not just a smarter prompt.

- Source: https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app
- Date: unknown
- Confidence: high
- Runs on device: ios-yes

### The industry minimum for reading as alive is three simultaneous loops, and Live2D's reference implementation publishes the exact constants — all of it is arithmetic you can reimplement without any SDK or license.


Read from Live2D's own source on 2026-08-26. Auto-blink (CubismEyeBlink): base interval 4.0 s, closing 0.1 s, closed 0.05 s, opening 0.15 s, and the next blink is scheduled at now + random()*(2*4.0 − 1.0), i.e. uniform over 0–7 s → mean ~3.5 s ≈ 17 blinks/min, which sits inside the human 15–20/min range. Breath (CubismBreath): value = offset + peak*sin(2π·t/cycle) applied on five channels with deliberately incommensurate periods — head X peak 15° cycle 6.5345 s, head Y 8° / 3.5345 s, head Z 10° / 5.5345 s, body X 4° / 15.5345 s, and ParamBreath offset 0.5 peak 0.5 cycle 3.2345 s (≈18.5 breaths/min, human resting range 12–20). The odd decimals exist so the composite never visibly repeats. Pointer/touch follow (CubismLook): head ±30° on X/Y/Z, body ±10°, eyeballs ±1. Plus named hit-test regions for tap reactions and a random pick from an "Idle" motion group when nothing else is playing.

- Source: https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/effect/cubismeyeblink.ts
- Date: unknown
- Confidence: high
- Runs on device: ios-yes

### Giving a cute non-human character a fully human voice measurably increases eeriness and reduces warmth — the only experiment that manipulated face-realism and voice-realism independently found exactly this.


Mitchell et al., i-Perception 2011, N=48, four 14-second videos, indices on −3..+3 scales. Eeriness: robot figure + human voice M = −0.10 (SE 0.15) vs robot figure + synthetic voice M = −0.60 (SE 0.13); human figure + synthetic M = 0.19 vs human + human M = −1.10. The two mismatched conditions rated significantly eerier than the two matched ones, t(47) = 6.042, p < 0.001. Warmth was *highest* of all four conditions for robot + synthetic voice (M = 0.28), which the authors attribute to the robot's cuteness. Their stated design principle: "the human realism of a character's visual elements and voice should match." Caveat that matters: their "synthetic voice" was 2010-era TTS, so the finding is about *matching*, not about deliberately degrading a 2026 voice — a stylized, expressive, slightly non-human voice is the read, not a robotic one.

- Source: https://hrilab.tufts.edu/publications/mitchelletal11iperception.pdf
- Date: 2011-03-01
- Confidence: high

### Clippy failed on interruption and non-adaptation, not on having a face — and interruption during focused work is quantified: interruptions every two minutes for twenty minutes produced significantly more stress, frustration, time pressure and effort with no quality gain.


Byron Reeves, whose Stanford research Microsoft built Clippy on, said "the worst thing about Clippy was that he interrupted"; Nass's account is that Clippy never learned names or preferences and repeated the same unhelpful information. Baym, Shifman, Persaud & Wagman (Microsoft Research, AoIR 2019) analysed 1,148 Clippy memes and concluded it "lacks interpersonal intelligence: it serves as a disruptive mediator between its user and the world." The interruption cost is measured in Mark, Gudith & Klocke, CHI 2008 (N=48, interruption frequency set to two minutes, IM or phone): interrupted tasks were completed *faster* with no quality difference, but stress F(1,46)=14.94 p<.001, frustration F(2,92)=5.21 p<.007, and effort and time pressure all significantly higher — after only 20 minutes. Every one of Clippy's failure conditions is reachable by a companion that speaks while someone is reading.

- Source: https://www.microsoft.com/en-us/research/publication/intelligent-failures-clippy-memes-and-the-limits-of-digital-assistants/
- Date: 2019-10
- Confidence: high

### In the only eye-tracked test of animation beside narrative content, irrelevant animation cut comprehension by ~28% and relevant animation was no better than static — the upside of an animated character in a comprehension task is roughly zero, the downside is large.


Wang et al., Journal of Eye Movement Research, published 2024-12-06. N=33 preschoolers, within-subjects, three conditions across three picture books. Comprehension means: high-relevant animation 3.32 (SE .22), static 3.02 (SE .25), low-relevant animation 2.18 (SE .25). Low-relevant animation was significantly worse than high-relevant (t=3.75, p<.001) and than static (t=2.67, p<.01); high-relevant animation showed no significant advantage over static. Eye-tracking confirmed the mechanism: low-relevant animation pulled total fixation duration off the story-relevant areas (t=−2.95) and onto the animated element (t=5.14 vs static), and fixation on relevant elements predicted comprehension (β=0.388, p<0.001). The population is preschoolers, so transfer to an adult reading a paper is an inference — but it is the sharpest published number on "a moving thing next to the text".

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11651708/
- Date: 2024-12-06
- Confidence: medium

### Meta-analysis says the cartoon styling and the guide role are the two agent choices that actually lower cognitive load; realistic and human-like agents do nothing, and the overall agent effect is tiny.


Frontiers in Psychology, 2025-07-24, 24 studies / 37 experimental conditions. Overall effect of a pedagogical agent on cognitive load g = −0.053 (95% CI −0.120 to −0.014, p = 0.046) — statistically real, practically negligible. Moderators: cartoon agents g = −0.122 (p<.05); realistic agents g = −0.014 (n.s.); human-like agents g = +0.028 (n.s.); agent in a *guiding* role g = −0.174 (p<.01) vs *explanatory* role g = +0.011 (n.s.); self-paced learning g = −0.180 (p<.01). Separately, Schroeder/Adesope-lineage meta-analyses put the learning benefit of agents at g ≈ 0.19–0.20 — small. Read as a prescription: a stylized cartoon sprite that guides and nudges is the only version the evidence supports; a realistic figure that explains is the version it rejects.

- Source: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1635465/full
- Date: 2025-07-24
- Confidence: high

### The Chinese companion market is the strongest available negative evidence: downloads collapsed ~80% in five months of 2025, three-day retention fell under 20%, and users abandon a given character after 5–7 days — and the cited cause is repetition and memory gaps, not the absence of a face.


人人都是产品经理, 2025-07-02, on Apple China data: 星野 (MiniMax) monthly downloads 4.86M in January → 0.93M in May (−81%) with DAU flat at ~96–97K; 猫箱 (ByteDance) 2.64M → 0.61M (−77%), DAU 590K → 490K. Three-day new-user retention dropped below 20% for 筑梦岛 and 星野. Quoted directly: "用户跟每一个角色平均的建联时长大概在5~7天，之后就基本不会再和这个角色聊天了." Churn causes named: dialogue repetition, memory gaps, homogeneous UGC personas, no narrative hook, exhausted interaction depth after thousands of turns. Same piece: Character.AI's 233M MAU generated $16.7M/year, ARPU $0.72/year. The article does not mention proactive push as a retention lever at all.

- Source: https://www.woshipm.com/ai/6237472.html
- Date: 2025-07-02
- Confidence: medium

### Shipped proactive-speech mechanisms are far dumber than the research frontier: a user-set frequency dial, quiet hours, and explicitly no strict timer.


Nomi.ai's own wiki: proactive messages "are not sent on a strict timer, so the exact timing can vary. They are intended to feel more natural than scheduled notifications"; frequency is a user setting in Conversation Settings; messaging pauses "10 PM to 8 AM local time"; solo chats only, not group chats. Tolan's model is a *daily activity set* generated per day (a topic from the Tolan's own life, a recommendation, a quiz) rather than continuous reaction, and its App Store listing (v26.33.1, 13+, 4.8 from 175K ratings) sells memory — "remember things we talked about two days ago and bring it back" — not cadence. No shipped vendor publishes an actual trigger rule or an interval number.

- Source: https://wiki.nomi.ai/When_Your_Nomi_Messages_You_First
- Date: unknown
- Confidence: medium

### The 2025–2026 research frontier treats silence as a first-class action to be chosen, not as the absence of a response — which is the actual architecture for "when to speak".


CleanS2S (arXiv 2506.01268, submitted 2025-06-02, CC-BY 4.0) pairs a memory system with a "Subjective Action Judgement" module that picks among five human-like strategies: interruption, refusal, deflection, **silence**, and standard response, trained via "Action Judgement SFT" on the input stream. "Proactive Conversational Agents with Inner Thoughts" (arXiv 2501.00383, v2 2025-02-18) has the model run "a continuous, covert train of thoughts in parallel to the overt communication process" and models its *intrinsic motivation* to voice each thought, choosing the moment; formative study N=24, and it beat baselines on anthropomorphism, coherence, intelligence and turn-taking appropriateness. Proact-VL (arXiv 2603.03447, ICML 2026) names the three problems explicitly: low-latency streaming inference, "autonomously deciding when to respond", and controlling quantity of generated content. None of these publish a threshold number; all of them are server-scale models.

- Source: https://arxiv.org/abs/2506.01268
- Date: 2025-06-02
- Confidence: high
- Runs on device: server-only

### There is a hard notification budget: past roughly six pushes a week, uninstall risk multiplies 3.4× and about 39% of users kill notifications at 3–6 per week.


A retail field experiment with 17,500 app users, five notification frequencies over seven weeks, found uninstalls rise and direct open rate falls monotonically with non-personalized frequency. Reported thresholds in the secondary summaries: users getting more than 6 pushes/week from one brand were 3.4× more likely to uninstall within 30 days than those getting 1–2; 39% disable notifications at 3–6/week; 12.6% of uninstalls attributed to excessive notifications; even one push per week costs ~10% notification-disable and ~6% uninstall. I could not open the primary paper (ResearchGate 403), so the exact table is unverified — but the direction and the order of magnitude are consistent across sources.

- Source: https://www.researchgate.net/publication/351932011_Mobile_apps_in_retail_Effect_of_push_notification_frequency_on_app_user_behavior
- Date: 2021-05
- Confidence: medium

### A pet character used as the *mediator* for a notification measurably softens its intrusiveness — the only direct experimental support for the "companion as the voice of the app" idea.


arXiv 2605.07960, 2026-05-08. Within-subjects pilot, n=11, four weeks (two weeks per version), real-world tourism scenario, comparing a baseline with no contextual alerts against pet-mediated context notifications built on air quality, noise, weather and proximity data. Finding: "the virtual pet effectively can 'soften' the perceived intrusiveness of system alerts, making safety-critical information feel more welcome and natural," and character-mediated justifications significantly improved notification clarity. n=11 pilot, so treat as directional — but it is the mechanism the concept art is reaching for: the sprite is not extra content, it is the delivery wrapper that makes an interruption tolerable.

- Source: https://arxiv.org/abs/2605.07960
- Date: 2026-05-08
- Confidence: medium

### Persona consistency breaks mechanically within about eight turns, and the shipped answer at the best-funded companion startup is not automated scoring but tiny hand-graded datasets for named failure smells.


Li et al., arXiv 2402.10962 ("Measuring and Controlling Instruction (In)Stability in Language Model Dialogs"): LLaMA2-chat-70B and GPT-3.5 show significant persona drift within eight rounds of self-chat; the paper attributes it to attention decay over the system prompt and proposes split-softmax, a training-free inference-time fix. Portola (Tolan) deliberately refuses automated conversation scoring — "A lot of what we're working on is really squishy stuff… I prefer to do it manually and use my own judgment" — and instead maintains problem-specific datasets of 10–200 examples named after the failure they catch: `somatic-therapy` (unwanted therapeutic questions), `or-questions` (excessive binary choices), `gen-z-lingo` (uncharacteristic slang). Their three stated trust pillars are authentic memory (nuanced recall, not perfect recall), authentic mirroring, and avoiding the tells that say "this is AI".

- Source: https://www.braintrust.dev/customers/portola
- Date: unknown
- Confidence: high

### By week three, users project their existing companion onto a generic chatbot — the character is largely constructed by the user, which means consistency and memory buy more than character content does.


arXiv 2510.10079, 2025-10-11. Study 1: survey of AI-companion users, N=303, mapping mental models → parasocial experience → social interaction. Study 2: longitudinal, N=110, existing companion users given a *generic* chatbot; "participants' perceptions of the generic chatbot significantly converged to perceptions of their own companions by Week 3." Attachment was shaped by perceived agency, parasocial interaction and engagement. Practical read for a reading app: elaborate personality writing has a short half-life; what the user keeps is the accumulated shared history, which is exactly the asset an observations pipeline already produces.

- Source: https://arxiv.org/abs/2510.10079
- Date: 2025-10-11
- Confidence: medium

### Physical companion robots get "alive" almost entirely from latency and warmth with near-zero intelligence, and they charge $299–$429 for it.


LOVOT (GROOVE X): eyes built from six layered 2D displays, body held at a perceived 37–39 °C using CPU waste heat, and a reaction time of 0.2–0.4 s to petting or hugging; it has no language interface at all and communicates through gaze, approach and non-verbal sounds. An observational study found LOVOT owners had higher baseline urinary oxytocin than non-owners. Casio Moflin ($429, US online sales from 2025-10-01) has no language either — head tilts, chirps, purrs, wiggles, a personality that diverges over ~50 days of interaction, and a companion app to inspect its emotional state; a February 2026 review found its constant mechanical whirring and neediness stressful. Ropet ($299 basic / $329 pro, CES 2025, first shipments March 2025): reacts to touch, audio and gesture, shows recognized objects as emoji in its eyes, makes stomach-rumble sounds when "hungry", widens its eyes and asks for a hug when it sees you look bored. Nothing here needs an LLM.

- Source: https://baike.baidu.com/en/item/LOVOT/2233093
- Date: unknown
- Confidence: medium

### There is no prior art for a vitality bar fed by token consumption, but there is a clean split in the adjacent evidence: bars that fall create abandonment, bars that only fill do not.


Grok's Ani ships an explicit affection state from −10 to +15 with five levels gating voice intimacy (L3), longer memory windows (L4) and unlocked content (L5) — but every number I found comes from SEO/secondary sites, not xAI. Finch ships the deliberate inverse and is explicit about it: "No guilt. No dark patterns. No 'Your bird will DIE!'" — no negative state, no health bar, nothing to disappoint; "Show up, things grow. Don't show up, things wait." It reached ~5M downloads and ~$1M monthly revenue by 2025. The Decision Lab (2026-03-02) summarising Silverman et al., Journal of Consumer Research 2023: users who break a streak are more likely to stop using the platform *entirely*, and offering a paid streak-repair option actually *reduces* motivation because it makes the streak the goal instead of the activity. Combined read: an energy bar that fills as the AI is used is the Finch pattern (safe); the same bar draining while the user is away is the Tamagotchi pattern (the one with documented abandonment risk). A separate, unstudied risk specific to the token framing: it makes API spend legible every session, which invites "am I burning money" as a recurring thought during reading.

- Source: https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification
- Date: 2026-03-02
- Confidence: medium

### California SB 243 has been in force since 2026-01-01 and its definition of "companion chatbot" fits this feature exactly — a study-companion framing does not fall into any of its three exclusions.


Signed 2025-10-13, effective 2026-01-01. Definition: "an artificial intelligence system with a natural language interface that provides adaptive, human-like responses to user inputs" that meets a user's social needs, exhibits anthropomorphic features, and can sustain a relationship across multiple interactions. The exclusions are: chatbots used solely for customer service / internal operations; video-game NPCs that cannot discuss mental health, self-harm or explicit content; and standalone consumer voice assistants without relationship continuity. A persistent character with memory and emotional states in a reading app is none of those. Duties: a clear and conspicuous notice that the companion is artificially generated and not human where a reasonable person could be misled; a published crisis protocol "for preventing the production of suicidal ideation, suicide, or self-harm content" plus referral to crisis services; and for *known minors*, AI disclosure plus notifications "at least every three hours" reminding them to take a break and that it is AI, plus blocking sexually explicit material. Private right of action: greater of actual damages or $1,000 per violation, plus fees. Reporting to the Office of Suicide Prevention starts 2027-07-01. New York's parallel law also mandates disclosure at start and every three hours.

- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- Date: 2025-10-13
- Confidence: high

### Apple added a third-party-AI data-sharing consent rule on 2025-11-13 and rebuilt age ratings in 2025 with an explicit instruction to count AI chatbot functionality — both bite an app that sends book pages and annotations to an LLM.


Guideline 5.1.2(i), verbatim: "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so." TechCrunch dates the addition to 2025-11-13; it is the first time third-party AI is named in the data-sharing scope. Age ratings (Apple Developer News, 2025-07-24): tiers expanded from 4+/9+ to add 13+, 16+ and 18+, responses required for every app by 2026-01-31 "to avoid an interruption when submitting your app updates", and "you must consider how all app features, including AI assistants and chatbot functionality, impact the frequency of sensitive content appearing within your app." Guideline 4.7 covers chatbots offered in an app and 4.7.1 requires objectionable-content filtering, a reporting mechanism and user blocking. Reference point: Tolan ships at 13+. Character.AI removed open-ended chat for under-18s entirely on 2025-11-25, ramping down from a 2-hour daily cap, with in-house age assurance plus Persona and, failing that, facial recognition and ID checks.

- Source: https://developer.apple.com/app-store/review/guidelines/
- Date: 2025-11-13
- Confidence: high

### Microsoft shipped the 2025 Clippy retry (Mico) and the criticism landed on exactly the Clippy axis — sappy, interruptive, unnecessary — which is why it is opt-out.


Announced October 2025, expanded from the US to 40 markets. Mico is a small amorphous animated character with a simple face that shifts colour with conversational tone, deliberately non-photorealistic, with anthropomorphism limited and activation "scoped to situations where visual feedback materially helps the user"; tapping it repeatedly turns it into Clippy as an easter egg. Reported user feedback: "sappy and interruptive and unnecessary and intrusive", with some users saying they stopped using Copilot when it appeared. It is a toggle. The design lesson a competitor already paid for: the character is scoped to voice mode, it is not photoreal, and it can be turned off — three constraints worth copying wholesale.

- Source: https://www.bleepingcomputer.com/news/microsoft/meet-the-new-clippy-microsoft-unveils-copilots-mico-avatar/
- Date: 2025-10-24
- Confidence: medium

## Numbers

### Live2D default blink: base interval / closing / closed / opening

- Value: 4.0 s base, next blink uniform over 0–7 s ahead (~17/min); 0.1 s closing, 0.05 s closed, 0.15 s opening
- Source: https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/effect/cubismeyeblink.ts

### Live2D default breath: sine periods (deliberately incommensurate) and amplitudes

- Value: ParamBreath 3.2345 s (≈18.5 breaths/min); head X 15°/6.5345 s, head Y 8°/3.5345 s, head Z 10°/5.5345 s, body X 4°/15.5345 s
- Source: https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/TypeScript/Demo/src/lappmodel.ts

### Live2D pointer/touch-follow ranges

- Value: head ±30° X/Y/Z, body ±10° X, eyeballs ±1
- Source: https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/TypeScript/Demo/src/lappmodel.ts

### Human spontaneous blink rate (for sanity-checking the above)

- Value: 15–20 blinks/min; blink duration 100–400 ms; 2–10 s between blinks
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC3151614/

### Eeriness of a cute non-human figure given a human voice vs a matched voice (−3..+3 scale)

- Value: robot+human voice −0.10 vs robot+synthetic −0.60; mismatch vs match t(47)=6.042, p<0.001; warmth highest for robot+synthetic at +0.28
- Source: https://hrilab.tufts.edu/publications/mitchelletal11iperception.pdf

### Comprehension with a low-relevance animated element beside the content vs static

- Value: 2.18 vs 3.02 (−28%), t=2.67 p<.01; high-relevance animation 3.32, not significantly better than static
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC11651708/

### Cognitive-load effect of an on-screen agent, by visual style (meta-analysis, 24 studies)

- Value: cartoon g=−0.122 (p<.05); realistic g=−0.014 (n.s.); human-like g=+0.028 (n.s.); overall g=−0.053
- Source: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1635465/full

### Agent role effect on cognitive load

- Value: guiding role g=−0.174 (p<.01) vs explanatory role g=+0.011 (n.s.)
- Source: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1635465/full

### Cost of interruption during focused work

- Value: interruptions every 2 min over 20 min → stress F(1,46)=14.94 p<.001, frustration p<.007, higher effort and time pressure, no quality gain (N=48)
- Source: https://www.ics.uci.edu/~gmark/chi08-mark.pdf

### iOS silent background push rate limit and background runtime budget

- Value: more than 3 background pushes/hour → system rate-limiting; up to 30 s of background runtime per wake; refresh timing chosen by the system
- Source: https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app

### Notification frequency vs uninstall

- Value: >6 pushes/week → 3.4× uninstall within 30 days vs 1–2/week; 39% disable notifications at 3–6/week (17,500-user, 7-week experiment)
- Source: https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/

### Chinese AI companion collapse, Jan→May 2025 (Apple China)

- Value: 星野 4.86M→0.93M monthly downloads (−81%), DAU flat ~96K; 猫箱 2.64M→0.61M (−77%), DAU 590K→490K; D3 retention <20%
- Source: https://www.woshipm.com/ai/6237472.html

### How long a user stays engaged with one AI character

- Value: 5–7 days, then that character is effectively abandoned
- Source: https://www.woshipm.com/ai/6237472.html

### Character.AI monetization reality

- Value: 233M MAU → $16.7M/year ≈ $0.72 ARPU/year
- Source: https://www.woshipm.com/ai/6237472.html

### Persona drift onset in dialog

- Value: significant instruction/persona drift within 8 rounds of conversation (LLaMA2-chat-70B, GPT-3.5)
- Source: https://arxiv.org/abs/2402.10962

### Portola/Tolan persona QA dataset sizes

- Value: 10–200 examples per named failure mode, graded manually daily
- Source: https://www.braintrust.dev/customers/portola

### When users' perception of a generic chatbot converges onto their own companion

- Value: Week 3 (N=110 longitudinal; N=303 survey)
- Source: https://arxiv.org/abs/2510.10079

### LOVOT reaction latency and body temperature

- Value: 0.2–0.4 s response to petting/hugging; 37–39 °C perceived body warmth from CPU waste heat
- Source: https://baike.baidu.com/en/item/LOVOT/2233093

### Physical companion pet prices (no language model in any of them)

- Value: Moflin $429; Ropet $299 / $329 Pro
- Source: https://www.casio.com/us/moflin/

### Nomi proactive messaging quiet hours

- Value: paused 10 PM – 8 AM local; user-set frequency; explicitly not on a strict timer
- Source: https://wiki.nomi.ai/When_Your_Nomi_Messages_You_First

### SB 243 minor break reminder and penalty

- Value: notification at least every 3 hours for known minors; $1,000 per violation or actual damages, whichever greater; in force 2026-01-01; reporting from 2027-07-01
- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243

### Apple age-rating overhaul deadline

- Value: new tiers 13+/16+/18+ added; questionnaire required for every app by 2026-01-31; AI/chatbot features must be counted
- Source: https://developer.apple.com/news/?id=ks775ehf

### Tolan App Store position (reference point for a companion app rating)

- Value: 13+, v26.33.1, 4.8 from 175K ratings, subscriptions $11.99 / $19.99
- Source: https://apps.apple.com/us/app/tolan-your-friendly-guide/id6477549878

## Fact-check

### Claim 6 [high]: Frontiers in Psychology meta-analysis (2025-07-24), 24 studies/37 conditions: overall g=-0.053 (CI -0.120 to -0.014, p=0.046); cartoon agents g=-0.122 p<.05, realistic g=-0.014 n.s., human-like g=+0.028 n.s.; guiding role g=-0.174 p<.01 vs explanatory g=+0.011 n.s.; self-paced learning g=-0.180 p<.01.

- Verdict: **corrected**

Correction: Everything is confirmed except the final self-paced figure, which the report has backwards. Per the paper's own Table 3: SELF-paced learning is g=+0.032, 95% CI [-0.054, 0.119], p=0.462 (NOT significant). It is SYSTEM-paced (not self-paced) learning that has g=-0.180, p=0.001 (significant). The claim's 'self-paced learning g = −0.180 (p<.01)' actually describes system-paced learning in the source; self-paced shows no significant cognitive-load benefit.

Evidence: Fetched https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1635465/full directly, including Table 3 moderator breakdown by pacing: 'Self-paced: k=20, g=0.032, 95% CI [-0.054, 0.119], p=0.462' and 'System-paced: k=14, g=-0.180, 95% CI [-0.285,-0.175], p=0.001', between-groups Q=9.332 p=0.002. All other numbers in the claim (overall g=-0.053 CI/p, cartoon g=-0.122, realistic g=-0.014, human-like g=+0.028, guiding g=-0.174 p=0.003, explanatory g=+0.011, 24 studies/37 conditions) confirmed exactly as stated.

### Claim 7 [medium]: 人人都是产品经理 2025-07-02 -- 星野 downloads 4.86M→0.93M (-81%) Jan-May 2025 with DAU flat ~96-97K; 猫箱 2.64M→0.61M (-77%), DAU 590K→490K; D3 retention <20%; 5-7 day character churn quote; Character.AI 233M MAU / $16.7M revenue / $0.72 ARPU.

- Verdict: **corrected**

Correction: DAU figure is off by 10x. The article states 星野 DAU as '96万和97万' (96万 = 960,000, not 96,000). Correct value: DAU flat at ~960K-970K, not ~96-97K.

Evidence: Fetched https://www.woshipm.com/ai/6237472.html directly. Verbatim: '星野基本持平不动，1月和5月的数据分别为96万和97万' -- 万=10,000, so this is 960,000/970,000, not 96,000/97,000. All other figures confirmed exactly: 星野 downloads 4.86M→0.93M, 猫箱 2.64M→0.61M and DAU 590K→490K, D3 retention <20%, verbatim quote '用户跟每一个角色平均的建联时长大概在5~7天，之后就基本不会再和这个角色聊天了' and Character.AI 233M MAU / $16.7M/yr revenue / $0.72 ARPU.

### N4: Human spontaneous blink rate 15-20/min, blink duration 100-400ms, 2-10s between blinks, per PMC3151614.

- Verdict: **corrected**

Correction: The cited article does not support these numbers. It is titled 'In the Blink of an Eye: Neural Responses Elicited to Viewing the Eye Blinks of Another Individual' and states human spontaneous blink rate as 'on average 20-50 times a minute' (citing Bentivoglio et al. 1997) -- not 15-20/min. The article contains no natural-blink figures for '100-400ms duration' or '2-10s interval'; its only duration/interval numbers (33ms, 2s) describe an artificial experimental stimulus, not natural blinking.

Evidence: Fetched https://pmc.ncbi.nlm.nih.gov/articles/PMC3151614/ directly and full-text-searched it. Verbatim: 'In real-life, spontaneous blinks in humans typically occur on average 20-50 times a minute' (Bentivoglio et al., 1997). No occurrence of '100-400', '15-20', or a natural inter-blink interval figure was found anywhere in the article.

### N11: Notification frequency vs uninstall -- >6 pushes/week → 3.4x uninstall within 30 days vs 1-2/week; 39% disable at 3-6/week; 17,500-user, 7-week experiment.

- Verdict: **refuted**

Correction: The cited businessofapps.com page contains no '3.4x', '17,500-user', or '7-week' figures anywhere -- confirmed by full-text search of the fetched page content. What the page does contain (attributed to Helplama research, a different study) is: 1 push/week → 10% disable notifications, 6% uninstall; 3-6/week → 40% disable (not 39%); >20/week → only 5% disable. The specific numbers in this claim do not appear on the cited source.

Evidence: Fetched https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/ via a text-extraction proxy after the site blocked direct fetch (403); searched full page text for '3.4', '30 days', '17,500'/'17500', '7-week' -- none found except an unrelated '3.4%' iOS reaction-rate stat from an Airship report. Only the Helplama disable/uninstall percentages above are present on the page.

### N12: Chinese AI companion collapse Jan→May 2025 -- 星野 4.86M→0.93M (-81%), DAU flat ~96K; 猫箱 2.64M→0.61M (-77%), DAU 590K→490K; D3 retention <20%.

- Verdict: **corrected**

Correction: DAU should read ~960K-970K, not ~96K (off by 10x -- '96万' means 960,000, not 96,000). All other figures in this number confirmed exact.

Evidence: Fetched https://www.woshipm.com/ai/6237472.html directly, verbatim '星野基本持平不动，1月和5月的数据分别为96万和97万' = 960,000/970,000. Download and retention figures otherwise match exactly (see claim 7).

## Dead ends

- Any design where the companion 'notices something and speaks up on its own' while the app is closed — iOS gives the app no autonomous background reasoning; silent background pushes are rate-limited above three per hour with a 30-second work budget, and BGAppRefreshTask timing is chosen by the system, so this requires a server that decides on the app's behalf.
- Giving the sprite a maximally human, realistic TTS voice to feel 'close to a real person' — that is precisely the mismatch condition Mitchell et al. measured as eerier (−0.10 vs −0.60) and less warm than a matched non-human voice on a cute non-human figure.
- Copying Character.AI / 星野 / 猫箱 companion depth as the retention engine — that market's own 2025 numbers are D3 retention under 20%, 5–7 days of engagement per character, an 80% download collapse in five months, and $0.72 ARPU per year at Character.AI's scale.
- An energy or vitality bar that drains while the user is away (the Tamagotchi pattern) — Journal of Consumer Research finds breaking a streak predicts abandoning the platform outright, and offering a repair option reduces motivation further; Finch ships the growth-only inverse and explicitly markets 'No guilt. No dark patterns. No your bird will DIE.'
- Framing it as a 'study companion' to escape SB 243 — the statute's only exclusions are customer-service bots, in-game NPCs restricted to game topics, and voice assistants without relationship continuity; a persistent character with memory and emotional states is none of them.
- Justifying the character on learning grounds — the pedagogical-agent meta-analytic effect is only g ≈ 0.19–0.20 for learning and g = −0.053 for cognitive load, and in the one comprehension eye-tracking test even story-relevant animation was no better than static.
- Animating the sprite continuously while the user's eyes are on the page — low-relevance motion beside narrative content pulled fixations off the relevant regions and cut comprehension from 3.02 to 2.18.
- Writing an elaborate personality bible as the main investment — users' perception of a generic chatbot converged on their own companion's by Week 3; accumulated shared history, not authored character content, is what survives.
- Licensing the Live2D Cubism SDK just to obtain idle behaviour — the entire recipe is four constants and a sine function readable from the reference source; the SDK is a rendering decision, not a liveness one.

## Open questions

- No shipped companion publishes its actual proactive cadence. Nomi says explicitly 'not on a strict timer' and exposes only a user-facing frequency dial; Tolan's mechanism is undisclosed and its primary pages (tolans.com FAQ, Fast Company, GeekWire) either omit it or returned 403. There is no vendor number for 'how many times a day does it speak first'.
- No study found on a stylized/cartoon character paired with 2025–2026-era expressive TTS. The face/voice mismatch evidence is from 2010-era synthetic speech, where 'synthetic' meant robotic; whether a modern warm-but-stylized voice on a cute sprite still counts as a mismatch is untested.
- No prior art at all for tying a companion's visible vitality to token or API consumption specifically. The adjacent evidence (Tamagotchi depletion vs Finch accumulation vs Grok affection levels) had to be reasoned across; nobody has published on making inference spend legible as a character's health.
- Could not verify a current Apple limit on the number of pending local notifications per app — the widely repeated 64 figure does not appear in the present UserNotifications documentation, and Apple's docs pages are JS-rendered so only the JSON API was readable.
- No published data on how App Store review actually treats a study/reading app that contains a companion character — no rejection corpus, no guideline naming companion characters specifically. The applicable rules (1.2, 4.7, 5.1.2(i), age ratings) are known; how a reviewer applies them to this shape is not.
- Grok Ani's affection scale (−10 to +15, five levels gating voice/memory/content) comes only from SEO and wiki-style secondary sources, never from xAI. The mechanism's existence is well attested; the exact numbers are not.
- WebSearch budget for this session was exhausted at 200 calls before I could check Chinese-market products beyond 星野/猫箱 — Doubao's desktop-pet behaviour, Zhipu, and 冒泡鸭 remain unexamined, and the Chinese-language results that did return were mostly low-quality SEO content rather than product or engineering documentation.

## Unverifiable
