# Round 3 / 4 — The behavior layer: from the soul's intent to a living body

> 第三轮调研，2026-09-10 跑。维度原题：the behavior layer of AI-driven virtual pets — how intent becomes behavior, continuously, between and during LLM turns, so a stylized small animal reads as alive and as *this* soul rather than as a screensaver. 姊妹维度分别覆盖运动模型、绑定与数据、iPad 运行时；本文只写 AI 与身体之间那一层。第一轮的 `round1-05-feeling-alive.md` 已覆盖眨眼/呼吸常数、打断代价、通知预算、陪伴 app 留存、人格漂移、LOVOT，本文不重复，只在需要接续时引用。
>
> 每条保留来源 URL、抓取日期和置信度。凡未从一手来源核实的，条目里写明。

---

## Headline

Not one shipped AI-driven pet generates body motion from the model: Peridot, Grok's Ani, Duolingo's Lily and Anki's Vector all have the language layer *select* from a pre-authored vocabulary, and every one of them puts the generation in a local controller that runs at 30–60 Hz blending one always-looping background layer with short triggered layers — and the two products where an LLM actually chose the creature's behaviors are both dead (Ani retired 2026-07-24, Peridot's servers off 2026-08-31) while the clip-selecting ones ship. The transferable architecture is Disney's BD-X split, stated in numbers: an animation engine composes artistic layers and hands a 50 Hz policy four scalars, and nothing above that loop runs faster than a conversational turn.

## Relevance to this repo

The pet is the empty desk (`src/soul/door.ts`), which means the hardest problem in the literature is already solved by the product's shape: the Wang et al. finding that a moving thing beside narrative text costs comprehension cannot apply to a body that only exists when no material is on the desk. What is left is the cheap part, and this repo already holds most of its pieces. `src/ui/components/orb/orb.ts` is the precedent in miniature and its constants are the right ones for a body too — asymmetric smoothing at 60 fps with `RISE_K` 0.35 and `FALL_K` 0.10, a 450 ms silence hold so state does not chatter between sentences, a ref-plus-rAF loop with zero re-renders, and a comment that already says the four states are pipeline states and nothing here returns a hue. A body is that module with more outputs.

The signals that need no second model call are all present: the four `OrbPhase` values, the 0..1 level at about 10 Hz through `subscribeLevel`, tool activity inside a turn, a legion run in flight (`src/legion`), budget pressure off `src/budget/ladder.ts`, whether the last distill or dream produced an observation the soul has not yet said, and pointer or touch. Those drive the body for free, continuously, at whatever rate the UI already ticks. What the model must add is small: a four-field intent emitted alongside the text of one turn, no extra call, no streaming channel. The proposed schema is in the finding below; its fields are named `attention`, `energy`, `posture` and `beat`, and the deliberate absence of a field named emotion is the legal line, not a stylistic choice — SB 243's definition turns on "anthropomorphic features" and a sustained relationship, and its only usable exclusion is written with the word "only", so a body that expresses where the soul is looking and how hard it is working stays inside "analysis related to source information" while a body that performs missing-you does not.

The layering answer is already dictated: the controller is arithmetic with no React in it, so it goes in a `.ts` beside its `.tsx`, registered in the LAYER table of `tests/layering.test.ts` exactly as `ui/components/orb` was. The intent type belongs with the turn assembly (`src/soul/`), not in `ai/` — it is the soul's output, and the tail already establishes that the soul owns what crosses desks. One thing this repo should not copy from any of the products below: none of them puts the model in the frame loop, and the cost structure says why. Vector's 575 animation triggers, Duolingo's 64 neutral combinations and Live2D's five incommensurate sine periods are all the same trick — variety is bought at the selection layer, not by generating anything.

## Findings

### The only shipped pet whose LLM chose creature behaviors made it choose from a pre-authored library by emitting JSON, and the product is dead.

Niantic's Peridot ran a customised Llama 2 (not Gemini, which is the premise this dimension was briefed with and which no source supports): Lightship ARDK's computer vision names the real-world objects in view, those words plus the Dot's personality traits go to the model, and the model returns JSON that selects from what Niantic calls its "vast library of animations". So the language layer decides *which* reaction, and the animation system decides what the body does. Meta's own writeup gives no latency, no animation count and no call cadence, and describes the loop as reacting to detected objects and to player voice or text rather than running continuously. Niantic Spatial announced in April 2026 that the game leaves the stores and the servers shut down on 2026-08-31, three years after launch; the company's stated reason is a pivot off phones to spatial mapping, not a failure of the pet, but the practical effect is that the field's flagship LLM-driven pet is no longer observable.

- Source: https://ai.meta.com/blog/niantic-peridot-llama/ ; https://mobilegamer.biz/niantic-is-closing-its-virtual-pet-game-peridot/
- Date: fetched 2026-09-10; Llama integration Nov 2023 – May 2024; shutdown announced 2026-04, servers off 2026-08-31
- Confidence: high on the architecture, medium on the shutdown date (secondary press, consistent across three outlets)
- Runs on device: server-only for the model, on-device for the animation selection

### Grok's Ani was clip-selected too, by a separate vendor's model, and that vendor now ships the same machinery as its own app.

Ani's movements were pre-recorded animations produced by Animation Inc.; the reported split is that Grok 4 handles dialogue while an Animation Inc. model called Ani-2 syncs gestures, expressions and idle behaviour to conversation context, choosing when to trigger which action rather than generating motion. xAI retired the 3D companions on 2026-07-24 calling them "an experiment", with removal completing around 2026-09-01. Animation Inc. shipped its own companion app, Animates, on 2026-08-28; the App Store listing (v1.0.18, 330.4 MB, 18+, 4.3 from 1.4K ratings as of 2026-09-10) sells "real-time voice, emotional range and presence" and a companion that "keeps thinking about what you talked about" while the app is closed, and says nothing whatsoever about how the body is driven. A reviewer who tested it describes the offline-thinking claim as scheduled generation against conversation history. Nobody outside the company has published its motion mechanism.

- Source: https://apps.apple.com/us/app/animates-life-companions/id6758621319 ; https://pocketanimus.com/guides/animates-app/ ; https://vchavcha.com/en/free-resources/grok-ani-tutorial/
- Date: fetched 2026-09-10; Animates released 2026-08-28; Grok companions retired 2026-07-24
- Confidence: medium — the Ani-2 attribution comes from secondary guides, not from xAI or Animation Inc.
- Runs on device: unknown

### Duolingo's Lily is the closest shipped precedent and its whole trick is combinatorial reuse, not generation.

Rive's own writeup of the Video Call feature says the State Machine "drives Lily's mouth positions, facial expressions, camera movements, and all other animations", and that instead of pre-baking a reaction per outcome the machine "dynamically blends animations in real time" because "we don't know what the learner is going to say". The published number is the important one: eight head animations and eight body animations that combine to over 64 variations of neutral movement. Expressions are event-triggered so that AI-driven responses sync to animation, and Lily's face adjusts to whether the learner speaks clearly, mumbles or pauses — all pipeline signals, none of them an emotion the model declared. The post gives no input list, no tick rate and no expression taxonomy.

- Source: https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life
- Date: post 2025-03-20, fetched 2026-09-10
- Confidence: high on what is stated, high on what is absent
- Runs on device: ios-yes (Rive runtime)

### Anki's Vector is the best-documented emotion-to-behavior-to-animation stack in any shipped consumer product, and its vocabulary sizes are all published.

The community technical reference manual, reverse-engineered from the shipped firmware, lays out four named tiers. Five emotion dimensions: Stimulated, Social, Confident, Happy, Trust — Trust added in v1.6, the first four shipped, and Cozmo had nine. Five "simple moods" (Default, Frustrated, HighStim, LowStim, MedStim) that change far more slowly than the emotions and are name-mapped to value ranges. About 70 "AI features", which is the level a person would describe. 86 behaviour classes in a behaviour tree of JSON nodes, one behaviour running at a time, actions queueing beneath. The flow is: sensor events raise stimulation, the behaviour tree posts an *emotion event* which is just an identifier string, the mood manager maps that string to an affector (which dimensions move, by how much, and a decay graph back toward neutral), and the current emotional state biases which behaviour is selected and which animation the animation engine picks for a given trigger. The manual's own design note is the part worth quoting: Vector "possesses just enough dimensions/aspects to his emotion model to drive responses and his goal-driven behaviour… When more dimensions are used, it is harder to get them right, and the less convincing the character is when they aren't."

- Source: https://randym32.github.io/Vector-TRM.pdf (Anki Vector Technical Reference Manual, 2021-02-14, ~543 pp.)
- Date: fetched and text-extracted 2026-09-10
- Confidence: high for a reverse-engineered document — the numbers come from named config files and enum tables, but Anki never published them
- Runs on device: the whole stack ran on the robot's Snapdragon; nothing here needs a server

### A trigger maps to a group, and mood plus random weighting resolves it — the anti-repetition mechanism lives in selection, not in generation.

Cozmo and Vector both use two levels of naming: an animation has a name, and animations are grouped under an *animation trigger* name. The SDK documentation states it plainly: "The engine may pick one of a number of actual animations to play based on Cozmo's mood or emotion, or with random weighting. Thus playing the same trigger twice may not result in the exact same underlying animation playing twice." Cozmo's SDK enumerates on the order of 575 animation triggers (the terminal `Count` member sits at id 575), and Vector's trigger-to-group table is a hardcoded JSON map, `AnimationTriggerMap.json`. This is the same shape as Duolingo's 8×8 and as Live2D's five incommensurate breath periods: a small number of authored parts, recombined so the composite never visibly repeats.

- Source: https://data.bit-bots.de/cozmo_sdk_doc/cozmosdk.anki.com/docs/generated/cozmo.anim.html ; Vector TRM ch. 97
- Date: fetched 2026-09-10
- Confidence: high on the mechanism, medium on 575 (inferred from the enum's Count member, not from a stated total)
- Runs on device: yes

### Disney's BD-X publishes the cleanest version of the split and the only hard cadence numbers in the whole field.

The RSS 2024 paper on the bipedal robotic character separates artistic intent from execution exactly the way an LLM-plus-controller wants to: artists author kinematic reference motions, a reinforcement-learned policy robustly executes them while rejecting disturbances, and "during runtime, these command signals are generated by an animation engine which composes and blends between multiple animation sources." The command signals are a handful of scalars — standing sends a head height offset and head orientation offset plus torso height and orientation; walking sends the head offsets plus path velocity and angular rate. The animation engine has three functional layers: a continuously looping background animation, triggered animations blended in with ratios ramping linearly from 0 to 1, and joystick modification on top. The policy runs at 50 Hz, actuator communication at 600 Hz, with first-order hold between policy updates and a 37.5 Hz low-pass. Blend times are authored per layer: 0.1 s for show functions, 0.35 s for body animation.

- Source: https://ar5iv.labs.arxiv.org/html/2501.05204 (Grandia et al., "Design and Control of a Bipedal Robotic Character", RSS 2024)
- Date: fetched 2026-09-10
- Confidence: high
- Runs on device: the policy is small enough to run onboard; the analogue here is a 60 Hz JS controller, not an RL policy

### aibo sits at the maximal end of the vocabulary scale, and a 2026 reconstruction of its behaviour corpus shows the actual grammar is tiny.

Sony's internal-state model for aibo is reported to carry 27 elements: 9 instinctive (fatigue, temperature, pain, hunger, thirst, affection, curiosity, elimination, sexual) and 18 emotional (happiness, sadness, anger, surprise, disgust, fear, frustration and others), with an ethological motivation model where internal state interacts with external stimuli to select behaviour. Against that, Tucker's 2026 analysis of the ERS-111 R-CODE sample behaviours reads 54 diagrams and 292 state instances and finds only 47 unique state titles, with the reused core being Sense/Decide (56 occurrences), Action Loop (51), Boot/Safe Pose (36), Synchronize (32), Sense Fall and Recover (14 each), all following one pattern: initialise, sense, decide, act, synchronize, repeat. The lesson for a schema is the gap between the two counts. A rich internal state does not require a rich action vocabulary, and the shipped action vocabulary is where the engineering cost lands.

- Source: https://arxiv.org/html/2607.12115 (Tucker, 2026-07-17); Sony internal-state figures via search summaries of the aibo patents and "AIBO: Toward the era of digital creatures"
- Date: fetched 2026-09-10
- Confidence: high for Tucker's counts; medium for the 27/9/18 figures, which were not read from the primary patent
- Runs on device: yes

### The open-source LLM-pet wave has converged on inline tags with a vocabulary of about eight, resolved locally into far fewer visible states.

Open-LLM-VTuber (13,691 stars, last pushed 2026-05-15) is the largest project of its kind and its mechanism is the minimum viable one: the model writes `[emotion]` tags inline in its reply text, and the frontend maps each tag name to an index into the Live2D model's `Expressions` array. The shipped default maps eight names onto four slots — neutral→0, fear→1, sadness→1, anger→2, disgust→2, joy→3, smirk→3, surprise→3. An expression persists until the next tag or until the utterance ends, then reverts to default. Everything else is a random pick from a named idle motion group. No structured output, no function call, no separate channel; the tags ride in the same token stream as the speech, which is what makes it free.

- Source: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber ; http://docs.llmvtuber.com/docs/user-guide/live2d ; star count via GitHub API
- Date: fetched 2026-09-10
- Confidence: high
- Runs on device: yes, the tag parsing is client-side

### The Sims is the canonical answer for what the body does when the model has said nothing, and it needs no intent at all.

The Sims' utility architecture inverts the usual direction: objects advertise how much they would satisfy each motive, the agent buckets its motives by current utility and only scores interactions that serve the top bucket, then applies a multiplier based on how depleted each motive is. Richard Evans, AI lead on The Sims 3, used a modified Boltzmann distribution to pick among the scored actions, which gives weighted-random selection with a temperature rather than always-argmax — the same anti-determinism device as Cozmo's random weighting, expressed as a formula. For a cat on an empty desk this is the whole idle system: three or four internal scalars that drift, a handful of actions that advertise against them, softmax selection, and the animal never repeats itself the same way twice.

- Source: https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf ; https://en.wikipedia.org/wiki/Richard_Evans_(AI_researcher)
- Date: fetched 2026-09-10
- Confidence: medium-high — the bucketing and advertisement mechanism is well documented in the Game AI Pro chapter; the Boltzmann detail is from the Wikipedia summary of Evans' GDC 2010 talk, not from the talk itself
- Runs on device: yes

### The smallest intent schema that fits this repo is four fields, emitted with the text of one turn, and it deliberately contains no emotion.

Nothing in the evidence supports letting the model name a feeling; everything supports letting it name where to look and how hard to move. The proposal:

```ts
// Emitted by the soul alongside the text of a turn. Never streamed, never a
// second call. Absent is legal and common — the controller keeps running.
export interface SoulIntent {
  attention: "reader" | "work" | "away"; // where the head and ears point
  energy: 0 | 1 | 2 | 3;                 // how much the body moves at all
  posture: "settle" | "sit" | "alert" | "stretch";
  beat?: "ack" | "found" | "stuck" | "done"; // one-shot, fires once, then gone
}
```

Four fields, at most four values each, 3×4×4×5 = 240 reachable configurations, which is between Vector's 5 dimensions and Duolingo's 64 combinations and well under the point the Vector manual warns about. Each field earns its place from a different body of evidence. `attention` is the only one of the three cheap always-on loops that needs an outside decision (blink and breath are pure arithmetic), and ear-plus-head orientation is the single strongest signal in the cat literature. `energy` is Vector's `Stimulated` scalar under a non-clinical name, and it is what decides whether the animal initiates anything at all. `posture` maps onto the measured feline time budget, where rest dominates and grooming follows rest. `beat` is Disney's triggered layer, blended over 0.35 s onto a background that never stops.

Everything else comes from signals the app already has, with no model involvement: `OrbPhase` sets a baseline energy floor and gates the mouth, the 10 Hz level modulates it, an in-flight tool call or legion run reads as `attention: "work"`, budget pressure lowers `energy`, an undelivered observation from the last distill arms a `beat: "found"` without deciding to speak, and touch drives a reflex the controller owns outright because a 400 ms round trip through a model is the difference between an animal and a widget.

- Source: this repo — `src/ui/components/orb/orb.ts`, `src/soul/door.ts`, `src/soul/tail.ts`, `src/budget/ladder.ts`, `src/legion/`, `docs/45`, `docs/48`, `docs/61`
- Date: read 2026-09-10
- Confidence: this is a proposal, not a finding; the constituent evidence is cited above
- Runs on device: yes

### The legal line runs between motion that reports on the machine's work and motion that performs a relationship, and adding a body moves the app toward the wrong side of one specific prong.

SB 243 §22601(b)(1) defines a companion chatbot as a system "capable of meeting a user's social needs, including by exhibiting anthropomorphic features and being able to sustain a relationship across multiple interactions." Cross-session memory already satisfies the second half, as `docs/45` records; a stylized cat with expressive posture squarely satisfies "anthropomorphic features", which the orb did not. The remaining exit is the same one `docs/45` identified, §22601(b)(2)(A), and its load-bearing word is still "only" — a bot used *only* for, among other things, "productivity and analysis related to source information". A body whose entire vocabulary is attention, effort and one-shot acknowledgements of work on the material stays describable that way. A body with an affection meter, a loneliness idle, or a greeting that scales with days since last visit does not, and it drags the memory scope with it. New York GBL §1700(4)(a)(ii) is untouched either way, because its trigger is *asking* unprompted emotion-based questions and motion asks nothing — but the same instinct that adds a sulk animation adds "you haven't been here in a while" to the greeting, and that sentence is the one that crosses. Both statutes remain dormant for a single user in mainland China (§22601(e) and §1700(8) both hook on the user's location), so this is a design constraint chosen now to avoid a rewrite later, not a present obligation.

- Source: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243 ; `docs/45` 法律边界 (for GBL §1700 and the jurisdiction analysis, already verified in round 2)
- Date: fetched 2026-09-10
- Confidence: high on the statutory text; the application to a body is an argument, not a holding
- Runs on device: n/a

### Cat signalling is unusually cheap to simulate because the informative channels are few and their predictive weight has been measured.

Cavallo et al.'s observational study of a free-ranging colony coded exactly three ear positions (erect; flattened to the sides; down and backwards) and two tail positions (up; horizontal or below the back line), giving six configurations per cat. In 254 cat-cat interactions across 29 identified individuals over 100 observation hours, only 16 of the 36 possible dyadic combinations (44.4%) ever occurred. Ears carried the outcome: both partners ears-erect predicted positive outcomes at Chi²=22.1, df=1, p<0.0001, while mismatched or non-erect ears predicted negative outcomes at Chi²=6.8 and 8.4, p<0.01. Tail position was near-useless between cats (75.6% of interactions had both tails down) but decisive toward humans, where the approach was overwhelmingly tail-up, Chi²=43.5, p<0.001. The engineering reading: a rig needs two ear degrees of freedom and one tail state to carry most of the animal's legible signal, and tail-up is the correct default when the body is addressing the reader.

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8469685/ ("Heads and Tails: An Analysis of Visual Signals in Cats, Felis catus")
- Date: fetched 2026-09-10
- Confidence: high
- Runs on device: n/a

### Real cats habituate fast, and a controller that reacts identically to the tenth stimulus is exactly what reads as a screensaver.

In the head-turn paradigm with 15 adult cats, responses to a repeated sound stimulus fell below 50% after the first seven presentations and levelled off around 32.45%. This is the one number in the whole dimension that directly addresses the brief's core question, because it says the difference between an animal and an animation loop is not variety of output but *decay of response to repeated input*. A controller therefore needs a per-stimulus habituation counter, not just a random idle picker: the first page-turn gets a head turn, the fifth gets an ear flick, the twentieth gets nothing, and the counter recovers over minutes. Vector's mood manager expresses the same idea from the other side, with every emotion event carrying a decay graph back toward neutral.

- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC5659213/ ; Vector TRM ch. 121.4
- Date: fetched 2026-09-10
- Confidence: high
- Runs on device: yes, it is a counter

### The feline idle budget is published and it is dominated by doing nothing, which is the cheapest possible authenticity.

Domestic cats spend about 50% of the time budget sleeping and resting, rising to 69–71% of a 24-hour day in some housed groups. Oral grooming is 4% of the overall budget, or 8% of non-sleeping time; 95% of grooming bouts cover two to seven body parts, 91% of oral grooming is multi-region, and scratch grooming takes about one-fiftieth of the time oral grooming does. There is a significant negative correlation between the duration of a sleep or rest period and the latency to the grooming bout that follows it — grooming follows rest. Translated to a controller: the resting posture should hold the majority of wall-clock time, a grooming bout should be scheduled preferentially on wake rather than at random, and a bout should chain two to seven part-targets rather than playing one loop.

- Source: Eckstein & Hart, "The organization and control of grooming in cats", Applied Animal Behaviour Science (PubMed 10771321), plus time-budget summaries
- Date: fetched 2026-09-10
- Confidence: medium — the percentages come from search summaries of the abstract and secondary sources, not from the full text
- Runs on device: n/a

### The slow blink is an experimentally validated affiliative signal and it is the cheapest single gesture available.

Humphrey et al. ran two experiments: 21 cats in 14 households, then 24 cats in 8 households with an experimenter the cats had never met. Cats slow-blinked back more after a human slow-blinked than in the neutral condition, and were more likely to approach an unfamiliar hand offered by someone who had slow-blinked first. Operationally the signal is eye-narrowing held for a beat and then a closure of a couple of seconds — one parameter more than the auto-blink loop whose constants round 1 already pulled out of Live2D (0.1 s close, 0.05 s hold, 0.15 s open, next blink uniform over 0–7 s). It is the correct render of `attention: "reader"` at `energy: 0`, and it says nothing about a relationship that a court would recognise.

- Source: Humphrey, Proops, Forman, Spooner & McComb, Scientific Reports 10 (2020), DOI 10.1038/s41598-020-73426-0, via https://www.sciencedaily.com/releases/2020/10/201007123031.htm
- Date: fetched 2026-09-10 (Nature paywalled the article body to this fetcher)
- Confidence: high on design and N, medium on the exact durations, which come from the press description
- Runs on device: n/a

### The shipped physical pet with the strongest emotional claims has no language model at all, which caps how much the body is actually buying.

Casio's Moflin uses sensors for touch, light, sound, motion and temperature to drive a mood that shapes head movements, chirps, purrs and wiggles; Casio's own marketing claims over four million emotional configurations and a personality that matures over 60 days, and the companion app visualises the emotional state. There is no LLM in it. Round 1 already recorded LOVOT buying attachment with a 0.2–0.4 s reaction and 37 °C of body warmth and no language whatsoever, and Moflin at $429 in the same shape. The relevance to a schema is a warning about attribution: a body that moves well makes the whole product feel alive, and that credit does not transfer to the model. It also means a bad body can eat the credit the model has earned.

- Source: https://www.casio.com/us/moflin/ ; https://www.prnewswire.com/news-releases/casio-introduces-moflin-the-emotionally-responsive-smart-companion-that-learns-and-evolves-with-you-302558268.html
- Date: fetched 2026-09-10
- Confidence: medium — "over four million emotional configurations" is a marketing figure with no published basis
- Runs on device: on-device, no cloud

### The most acclaimed cat character in games has no procedural layer at all, and there is no GDC talk about one.

Stray's cat was animated entirely by keyframe from video reference, with no motion capture and no published procedural locomotion system; the animator's stated method was collecting reference and hand-animating the trot, the tail twitch, the ears and the whiskers. Searches for a GDC talk on Stray's cat controller, and separately for the Untitled Goose Game behaviour-tree talk this dimension was briefed to find, return nothing — the only Untitled Goose Game GDC session is a level-design talk about location scouting in Street View. Two conclusions. First, "generated motion" is not what makes an animal read as an animal, and the industry's best evidence points the other way. Second, this repo should not budget for a motion model on the grounds that shipped cat characters use one, because they do not.

- Source: https://www.linkedin.com/pulse/process-animating-impressivly-cute-cat-stray-charlie-forster ; https://www.gamedeveloper.com/design/come-to-gdc-and-see-how-i-untitled-goose-game-i-s-levels-were-scouted-
- Date: searched 2026-09-10
- Confidence: high on Stray's method, medium on the absence of talks (an absence from search is weaker than a checked index)
- Runs on device: n/a

### Reaction latency, not intelligence, is the budget that decides whether the body reads as alive, and the thresholds are old and stable.

Nielsen's response-time limits still bound the design: under 0.1 s is perceived as instantaneous and preserves the sense of direct manipulation, up to about 1 s the user notices but keeps their flow, past 10 s attention is gone. Human visual reaction time sits near 200 ms, which is the same band as LOVOT's 0.2–0.4 s. This is what forces the split: an intent from a model arrives hundreds of milliseconds to seconds after the event that prompted it, so every reaction the user causes directly — a tap, a scroll stopping, the microphone opening — has to be produced by the local controller inside 100 ms and cannot wait for anything. The model's intent is only ever allowed to change the *character* of a reaction that has already started.

- Source: https://www.nngroup.com/articles/response-times-3-important-limits/ (thresholds as summarised in secondary UX literature fetched 2026-09-10); LOVOT figure via round1-05
- Date: fetched 2026-09-10
- Confidence: high on the thresholds, which are stable and widely reproduced; the specific Nielsen page was not fetched directly
- Runs on device: n/a

### What should be suppressed is not the body but its locomotion, and the empty-desk framing already does most of the work.

Round 1's baseline stands: a moving thing beside narrative content pulled fixation off the story-relevant areas and cost comprehension (Wang et al., N=33, low-relevance animation 2.18 vs static 3.02), and interruption during focused work raised stress, frustration and time pressure with no quality gain after only twenty minutes (Mark et al., N=48). Because the pet lives on the empty desk, none of that applies while the reader is on a page. The residual risk is inside a conversation, and it has a shape: while the soul is thinking or a tool or a legion run is in flight, the reader is waiting on an answer, and that is exactly when a body that wanders, grooms or plays is competing with the thing it is supposed to be doing. The suppression rule is therefore by layer, not by on/off — the background loop (breath, blink, micro-drift) always runs, `beat` one-shots are allowed because they report on the work, and locomotion plus idle bouts are gated off whenever `OrbPhase` is not idle or a run is active. That also matches what the pedagogical-agent meta-analysis found benefits from: a guiding agent lowers cognitive load, an explaining one does not.

- Source: round1-05, citing https://pmc.ncbi.nlm.nih.gov/articles/PMC11651708/ , https://www.ics.uci.edu/~gmark/chi08-mark.pdf , https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1635465/full
- Date: as recorded in round 1, 2026-08-26
- Confidence: high, inherited
- Runs on device: n/a

### The 2025–2026 open-source desktop-pet wave adds screen awareness and proactive speech, which is the failure mode this repo has already priced.

The live cluster is: Open-LLM-VTuber (13.7k stars) with hands-free voice, interruption and a transparent desktop-pet mode; BongoCat, which is purely reactive to keyboard, mouse and gamepad with Live2D models and no model at all; a Steam-distributed "AI Desktop Pet" with a bundled local LLM that "sees your screen and starts conversations on its own"; and smaller LLM pets such as MeaPet (37 stars, 2026-08-24) and Mochi, which reads the active window and cursor and reacts in character by walking, watching, sleeping and sulking. The direction of travel across all of them is toward screen-reading plus unsolicited speech. That is the Clippy axis, and it is the one thing round 1 established a hard budget against.

- Source: https://github.com/Open-LLM-VTuber/Open-LLM-VTuber ; https://store.steampowered.com/app/4227700/AI_Desktop_Pet/ ; https://bongocat.gjxx.dev/ ; https://reporank.net/en/repo/suan-11-mea-pet-public.html
- Date: fetched 2026-09-10
- Confidence: medium — star counts verified for Open-LLM-VTuber only; the others come from listings and aggregator pages
- Runs on device: desktop only; none of these has an iOS build

## Numbers

### Disney BD-X control rates

- Value: RL policy 50 Hz; actuator comms 600 Hz; first-order hold between policy steps; 37.5 Hz low-pass
- Source: https://ar5iv.labs.arxiv.org/html/2501.05204

### Disney BD-X animation blend times

- Value: show functions 0.1 s, body animation 0.35 s; triggered blend ratios ramp linearly 0→1 over a continuously looping background layer
- Source: https://ar5iv.labs.arxiv.org/html/2501.05204

### Disney BD-X command-signal count

- Value: 4 scalars standing (head height offset, head orientation offset, torso height, torso orientation); 4 walking (head offsets, path velocity, angular rate)
- Source: https://ar5iv.labs.arxiv.org/html/2501.05204

### Anki Vector vocabulary sizes

- Value: 5 emotion dimensions (Stimulated, Social, Confident, Happy, Trust; Cozmo had 9); 5 simple moods; ~70 AI features; 86 behaviour classes; 7 top-level states
- Source: https://randym32.github.io/Vector-TRM.pdf

### Cozmo animation triggers

- Value: ~575 animation trigger names; each maps to a group, resolved by mood plus random weighting
- Source: https://data.bit-bots.de/cozmo_sdk_doc/cozmosdk.anki.com/docs/generated/cozmo.anim.html

### aibo internal state

- Value: 27 internal-state elements — 9 instinctive, 18 emotional
- Source: search summaries of Sony patents and "AIBO: Toward the era of digital creatures" (not verified against the primary patent)

### aibo ERS-111 behaviour corpus

- Value: 54 diagrams, 292 state instances, 47 unique state titles; top reuse Sense/Decide 56, Action Loop 51, Boot/Safe Pose 36, Synchronize 32
- Source: https://arxiv.org/html/2607.12115

### Duolingo Lily animation combinatorics

- Value: 8 head × 8 body animations → 64+ neutral movement variations, blended at runtime
- Source: https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life

### Open-LLM-VTuber emotion tag vocabulary

- Value: 8 inline `[emotion]` tag names mapped onto 4 Live2D expression slots (neutral 0; fear/sadness 1; anger/disgust 2; joy/smirk/surprise 3); 13,691 stars, last push 2026-05-15
- Source: http://docs.llmvtuber.com/docs/user-guide/live2d ; GitHub API

### Cat visual-signal coding

- Value: 3 ear positions × 2 tail positions = 6 configurations per cat; 36 dyadic combinations possible, 16 (44.4%) observed; 254 cat-cat and 104 cat-human interactions, 29 cats, 100 hours
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8469685/

### Cat signal predictive weight

- Value: both cats ears-erect → positive outcome, Chi²=22.1, df=1, p<0.0001; non-erect or mismatched ears → negative, Chi²=6.8 and 8.4, p<0.01; tail-up toward humans Chi²=43.5, p<0.001
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC8469685/

### Cat habituation to a repeated stimulus

- Value: head-turn response drops below 50% after 7 presentations, levels off at ~32.45%; N=15 adult cats; responses scored within 5 s of stimulus onset
- Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC5659213/

### Cat time budget

- Value: ~50% of the budget sleeping and resting (69–71% of 24 h in some housed groups); oral grooming 4% of the total budget, 8% of non-resting time; 95% of grooming bouts cover 2–7 body parts; scratch grooming ~1/50 of oral grooming time
- Source: Eckstein & Hart, Appl. Anim. Behav. Sci. (PubMed 10771321), via search summaries

### Cat slow-blink experiment

- Value: experiment 1, 21 cats in 14 households; experiment 2, 24 cats in 8 households with unfamiliar experimenters
- Source: Humphrey et al., Sci. Rep. 10 (2020), DOI 10.1038/s41598-020-73426-0

### Response-latency thresholds

- Value: <0.1 s perceived as instantaneous; ~1 s keeps flow; 10 s loses attention; human visual reaction ~200 ms; LOVOT 0.2–0.4 s
- Source: Nielsen response-time limits as reproduced in UX literature; LOVOT via round1-05

### Proposed intent schema size

- Value: 4 fields, ≤4 values each, 240 reachable configurations (3 attention × 4 energy × 4 posture × 5 beat-including-absent), emitted at turn boundaries only
- Source: this document

### Shipped AI-pet mortality, 2026

- Value: Grok 3D Companions retired 2026-07-24 (removal ~2026-09-01); Peridot servers off 2026-08-31 after ~3 years; Animates shipped 2026-08-28, 4.3 from 1.4K ratings, 330.4 MB, 18+
- Source: search results 2026-09-10; https://apps.apple.com/us/app/animates-life-companions/id6758621319

## Rejected

**Putting the model in the frame loop.** No shipped system does it and the latency arithmetic forbids it: reactions the user causes must land inside 100 ms, and the fastest realistic intent round trip is hundreds of milliseconds. Every product examined here — Peridot, Ani, Lily, Vector, BD-X — separates a slow selection layer from a fast execution layer.

**A second LLM call for behaviour.** The whole point of the four-field schema is that it rides in the same call and the same token stream as the reply, the way Open-LLM-VTuber's inline tags do. A dedicated behaviour call doubles cost, doubles latency and adds a failure mode where the body contradicts the words.

**An emotion vector on the body.** `docs/45` already killed eight emotions for the orb on the grounds that no shipped implementation expresses emotion rather than pipeline state; the body evidence agrees from a second direction. Vector shipped five internal dimensions and its own manual says more makes the character worse, and the field's only larger vocabulary (aibo's 27) sits behind a 47-state action grammar. On top of that, an emotion field is the field that costs the SB 243 exclusion.

**Peridot as a model to copy.** Its architecture is worth citing and its outcome is worth noting, but the game is off the stores and the servers are dead as of 2026-08-31, so nothing about it can be measured any more.

**A GOAP planner.** Nothing in the surveyed products uses one for a pet. Behaviour tree (Vector, and the games canon) and utility selection (The Sims) are what shipped, and a pet on an empty desk has no goal stack deep enough to plan over.

**Budgeting for a motion model on the grounds that cat games use one.** Stray is hand-keyframed from video reference with no procedural layer, and there is no GDC talk on a Stray or Untitled Goose Game behaviour architecture to mine. If a motion model is worth building here, the case has to come from the sibling dimension on motion models, not from precedent.

**Screen-reading and self-initiated conversation, which is where the 2026 desktop-pet wave is going.** That is the Clippy axis round 1 measured, and it is already out of scope by `docs/45`'s rule against unprompted emotion-based questions.

## Gaps

**No shipped product publishes an LLM call cadence for a pet.** Peridot, Ani and Lily all describe reacting to events; not one states how often the model is consulted or what it costs per minute. The 50 Hz figure in this document is Disney's control loop, not a model rate, and no equivalent number exists on the language side.

**Animates' motion mechanism is unverified.** The App Store listing and the one review that discusses it say nothing about whether motion is generated or clip-selected. Given the same studio's Ani was clip-based, clip-based is the prior, but this is inference. The brief forbade contacting them, and no teardown exists.

**The Vector TRM is reverse-engineered.** Every vocabulary count in this document that comes from it — 5, 5, 70, 86, 7 — was read out of firmware config files by a community author, not published by Anki. The counts are internally consistent and the document names its sources, but there is no way to confirm them against Anki.

**Cat reaction latency in milliseconds was not found.** The head-turn literature scores responses within a 5 s window and reports direction, not time. The 200 ms target in this document comes from human perception thresholds and LOVOT's published figure, not from an animal measurement.

**The feline time-budget percentages were not read from the primary text.** Eckstein & Hart's abstract and secondary summaries agree, but the full paper was not fetched and the housing conditions behind the 69–71% figure are unclear.

**No experiment exists on an animated companion beside adult reading.** Round 1 recorded this and it is still true; the empty-desk framing routes around the question rather than answering it.

**No power measurement for a 60 Hz controller in a WKWebView on an iPad.** `docs/45` already lists this as unmeasured for four CSS states. A rigged body with a per-frame controller is strictly more expensive and there is no number for either.

**Moflin's "four million emotional configurations" has no published basis.** It is a marketing claim reproduced across coverage with no methodology, and it is quoted here only as an example of the claim, not as a measurement.
