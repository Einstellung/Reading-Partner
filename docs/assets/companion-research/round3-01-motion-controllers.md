# Round 3 / 1 — Learned motion controllers for a small-animal character

> 第三轮调研，2026-09-10 跑。所有数字回原始论文 / 仓库核对过，抓取日期 2026-09-10。核不到的写在 Gaps。
>
> 维度原题：Neural / learned motion controllers for a quadruped or small-animal character — the lineage from PFNN through 2026, what exists for cats and dogs specifically, what is inferable about Animation Inc, the honest smallest thing that gives a non-repeating controllable cat, and where such a controller would run in this app.

---

## Headline

The learned-quadruped lineage is real, cheap enough to run in the WebView (11.1 MFLOPs per frame, and Meta's own 2026 dog controller only evaluates the network 10 times a second), and it comes with exactly one dataset — the same 30 minutes of realistic dog mocap captured in 2018, non-commercial, reused unchanged by every quadruped result since; there is no cat data, no stylized-animal data, and no pretrained weights for anything that is not a realistic dog or wolf, so a learned controller would buy this app physically-plausible *walking* it does not need while costing it the stylization that is the entire point, and the honest smallest thing that gives a non-repeating controllable cat is a procedural rig (springs, noise fields, IK look-at, secondary motion on tail and ears) with no learned model at all.

## Relevance to this repo

The compute question is settled and it is not the interesting question. A MANN-sized quadruped controller is 11.1 MFLOPs per frame; Meta's 2026 rework runs the network at 10 Hz and blends to 30 Hz for display, so the real budget is ~111 MFLOP/s. That is a few percent of one Apple CPU core, reachable from plain TypeScript over `Float32Array` with no runtime, no ONNX, no Swift and no CoreML — and CoreML is actively the wrong answer, because the Apple Neural Engine pays a 0.23 ms floor on *every* dispatch regardless of size, so a network this small spends ~98% of its wall time on dispatch and gains nothing, on top of an IPC hop the app would have to build. ONNX Runtime Web is available if a real network lands (the repo already sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` in `src-tauri/tauri.conf.json`, so WASM threads are unlocked), but its WebGPU/JSEP backend must be avoided: there is an open bug where JSEP on WebKit 26 pins CPU at 400%+ and grows memory past 14 GB, crashing the content process on iOS — the same content-process death the sprite-sheet memory number ruled out in round 1. What actually blocks this path is data and licence, not silicon. Every public quadruped controller from 2018 to 2026 — MANN, Local Motion Phases, MoGlow, Learned Motion Matching's Dog scenario, and Meta's AI4AnimationPy quadruped demo — is trained on one 30-minute capture of a real dog, released CC BY-NC 4.0 with the surrounding code marked "research or education purposes, not freely available for commercial use or redistribution". A PolyForm-NC app can probably live with CC BY-NC on the data, but the deliverable is a realistic dog gait, and retargeting that onto a stylized cat destroys the stylization the founder is asking for. Second, the states this app needs — idle, listening, thinking, speaking, has-something-to-say, touch — are not locomotion states, and a MANN-class controller is a locomotion controller whose main input is a desired ground trajectory that a pet sitting beside a page never has. Non-repetition does not come from the model class either: it comes from feeding a continuous stochastic signal into a controller, and a noise-driven spring rig never repeats for exactly the same reason. So the recommendation is the hybrid: build the cat as a procedural rig first (the blink/breath/gaze loops already documented in `docs/45` are the same machinery, one dimension up), and only add a learned or motion-matched layer if the cat ever has to actually walk across the screen, at which point Learned Motion Matching is the cheapest learned option on record for a quadruped (6.5 MB, 262 µs/frame, versus MANN's 16.9 MB and 2440 µs on the same machine and the same dog). One cost that is *not* in any of these numbers and dwarfs all of them: the app currently has no 3D renderer, and a rigged quadruped in the WebView means adding one on top of pdfium.wasm.

## Findings

### The lineage exists, is fifteen years deep, and every step is small enough for a tablet — the smallest learned locomotion controllers are single-digit megabytes and hundreds of microseconds per frame on a 2020 desktop CPU, single-threaded.

The chain is Motion Matching (Clavet, GDC 2016, non-neural nearest-neighbour over a mocap database) → PFNN (Holden, Komura, Saito, SIGGRAPH 2017: a three-layer 512-unit ELU network whose weights are a cyclic spline of four control points indexed by gait phase) → MANN (Zhang, Starke, Komura, Saito, SIGGRAPH 2018: the same regression network but with weights blended from 8 expert sets by a 32-unit gating network reading foot velocities, which replaces the hand-defined phase and is what made quadrupeds work) → Neural State Machine (SIGGRAPH Asia 2019, adds goal-directed scene interaction) → Local Motion Phases (SIGGRAPH 2020, per-limb phases for asynchronous contacts; its shipped demo includes a quadruped locomotion controller) → Learned Motion Matching (Holden et al., SIGGRAPH 2020, four small networks that emulate Motion Matching's own steps and delete the database) → DeepPhase (SIGGRAPH 2022 Best Paper, a periodic autoencoder that learns phase unsupervised) → Categorical Codebook Matching (Starke, Starke, He, Komura, Ye, SIGGRAPH 2024, Meta) → AI4AnimationPy (Meta / facebookresearch, 2026, the whole stack ported to PyTorch with a pretrained quadruped controller). Every one of these is a feed-forward network in the 0.5–6 M parameter range evaluated once per frame or less; none of them is a large model in the 2026 sense.

- Source: https://www.pure.ed.ac.uk/ws/files/35467734/phasefunction.pdf , https://www.pure.ed.ac.uk/ws/portalfiles/portal/60838109/dog2.pdf , https://theorangeduck.com/media/uploads/other_stuff/Learned_Motion_Matching.pdf , https://github.com/sebastianstarke/AI4Animation , https://github.com/facebookresearch/ai4animationpy
- Date: 2017-07 / 2018-08 / 2020-07 / 2022-08 / 2024-07 / fetched 2026-09-10
- Confidence: high
- Runs on device: ios-yes (CPU, arithmetic only)

### There is exactly one public quadruped motion dataset in this lineage — 30 minutes of one real dog, captured in 2018 — and every quadruped result since, including Meta's 2026 one, is trained on it.

MANN's dataset is "30 minutes of unstructured dog motion capture data" covering walk, pace, trot, canter, sitting, standing, idling, lying and jumping, doubled by mirroring, fitted to a 27-bone / 81-DoF skeleton, captured on flat terrain only because the capture facility could not do otherwise. Learned Motion Matching's "Dog" scenario is 124,418 frames at 60 Hz (34.6 minutes) on a 58-joint rig — the same capture. MoGlow (Henter, Alexanderson, Beskow, SIGGRAPH Asia 2020) states outright that it uses "30 minutes of dog motion capture from Zhang et al. 2018". The Meta 2026 quadruped demo's own source header says "The codebook matching model is trained on the same data as in the paper." Eight years of architecture progress, one animal, one afternoon of capture.

- Source: https://www.pure.ed.ac.uk/ws/portalfiles/portal/60838109/dog2.pdf , https://theorangeduck.com/media/uploads/other_stuff/Learned_Motion_Matching.pdf , https://raw.githubusercontent.com/facebookresearch/ai4animationpy/main/Demos/Locomotion/Quadruped/Program.py
- Date: 2018-08 / 2020-07 / fetched 2026-09-10
- Confidence: high

### Pretrained quadruped weights do exist and are downloadable today, but they are a dog and a wolf, and the licence is CC BY-NC 4.0 on top of a "research or education only, no redistribution" notice.

Meta's `facebookresearch/ai4animationpy` ships `Demos/Locomotion/Quadruped/Network.pt` at 60,224,077 bytes plus `Postprocessor.pt` at 1,656,644 bytes, with `Dog.glb` and `Wolf.glb` meshes and nine named guidance clips (walk, pace, trot, canter, jump, sit, stand, lie, idle). The repository LICENSE is Creative Commons Attribution-NonCommercial 4.0 International. The older Unity AI4Animation repository ships MANN's trained `Parameters.asset` in the SIGGRAPH_2018 demo and states: "This project is only for research or education purposes, and not freely available for commercial use or redistribution. The motion capture data is available only under the terms of the CC BY-NC 4.0 license." Reading-Partner is source-available under PolyForm-NC, so the non-commercial half is survivable; the "no redistribution" clause on the Unity project's code is not, and would force the same fetch-at-build-time pattern the Live2D analysis rejected in round 1.

- Source: https://github.com/facebookresearch/ai4animationpy , https://raw.githubusercontent.com/sebastianstarke/AI4Animation/master/README.md
- Date: fetched 2026-09-10
- Confidence: high
- Runs on device: ios-no (60 MB PyTorch checkpoint, would need export and quantization first)

### Meta's 2026 quadruped controller only evaluates the network ten times a second and blends the result up to thirty — the per-frame cost people quote for these controllers is not what a shipping one pays.

`Demos/Locomotion/Quadruped/Program.py` sets `SEQUENCE_FPS = 30` and `PREDICTION_FPS = 10`, and re-runs inference only when `Time.TotalTime - self.Timestamp > 1.0 / PREDICTION_FPS`, interpolating between predictions on the intervening frames. It is a codebook-matching model — a rework of the 2018 MANN paper, per its own header comment — with FABRIK inverse kinematics and a separate leg-IK pass applied on top of the network output. Two consequences for this app: the inference budget is three to six times smaller than a naive per-frame estimate, and the visible quality of the result depends on post-processing (IK, contact locking) that is ordinary deterministic code, not on the network.

- Source: https://raw.githubusercontent.com/facebookresearch/ai4animationpy/main/Demos/Locomotion/Quadruped/Program.py
- Date: fetched 2026-09-10
- Confidence: high
- Runs on device: ios-yes (the 10 Hz scheme transfers regardless of model)

### For a quadruped, Learned Motion Matching beats the learned mixture-of-experts controllers on both axes at once — same dog data, 2.6× less memory and 9× less time per frame than MANN.

Table 3 of the Learned Motion Matching paper measures all methods on the same machine (Intel Xeon 3.5 GHz, 12 core, single-threaded, custom inference library). On the Dog scenario: basic Motion Matching needs 136.5 MB and 131 µs/frame; Motion Matching with only the learned Decompressor needs 36.3 MB; full Learned Motion Matching needs 6.5 MB and 262 µs/frame; MANN on the same data needs 16.9 MB and 2440 µs/frame. PFNN on the Terrain scenario is 9.3 MB and 1370 µs/frame. Average joint position error for the Decompressor is 1.4 cm (SD 1.1 cm). The authors also note weights compress to 16-bit integers "without significant loss of precision or runtime performance", halving memory again. The extreme case in the same table is the Bear scenario: 995.6 MB of Motion Matching database becomes 7.1 MB of network weights.

- Source: https://theorangeduck.com/media/uploads/other_stuff/Learned_Motion_Matching.pdf
- Date: 2020-07
- Confidence: high
- Runs on device: ios-yes

### The whole MANN dog controller is 11.1 MFLOPs per frame, and pruning 90% of its parameters leaves 1.74 MFLOPs and 2.2 MB while producing *better* motion than a dense network of the same size.

Hubens et al. (VISIGRAPP 2022) pruned the exact Zhang et al. 2018 model (8 experts, hidden 512) on the same dog data. Their Table 1: 0% sparsity = 178 Mb of 32-bit floats (22.25 MB) and 11.10 MFLOPs per frame; 50% = 88 Mb and 5.89 MFLOPs; 90% = 17.8 Mb (2.2 MB) and 1.74 MFLOPs. Their headline result is that for an equal number of non-zero parameters, the pruned network generates more natural motion than a dense network shrunk to that size, and that even at 90% sparsity the high-level features each expert learns stay recognisably the same. The FLOP number is dominated by the expert blending, not the forward pass: blending 8 × ~695k parameters is 5.56 M multiply-accumulates, which is where 11.1 MFLOPs comes from.

- Source: https://arxiv.org/abs/2201.04042
- Date: 2022-01-11
- Confidence: high
- Runs on device: ios-yes

### There is no cat. The only public cat motion in this field is inside Truebones Zoo, where a typical skeleton has 600–1200 frames — twenty to forty seconds — and the licence is pay-what-you-want plus a gated research request.

AnyTop (Gat et al., SIGGRAPH 2025) is the current state of the art for "any skeleton" animal motion and it is built on Truebones Zoo: 70 skeletons across mammals, birds, insects, dinosaurs, fish and snakes, 3 to 40 motions per skeleton, 1219 motions and 147,178 frames in total — roughly 82 minutes for all 70 animals combined. Their evaluation benchmark deliberately selects "30 skeletons randomly selected from those with cumulative frame counts ranging between 600 and 1200", which is the honest scale of per-animal data. A cat is in the set and AnyTop demonstrates zero-shot generation for a cat held out of the quadruped training split, but AnyTop is a 100-step diffusion model that runs offline on an RTX 2080 Ti, not a real-time controller. Truebones Zoo itself is sold pay-what-you-want on Gumroad; the derived research releases are non-commercial only.

- Source: https://arxiv.org/pdf/2502.17327 , https://truebones.gumroad.com
- Date: 2025-02-24 / fetched 2026-09-10
- Confidence: high
- Runs on device: ios-no

### Training a controller from a *single* short clip is a solved research problem, which is the only learned path that survives the data problem — but it costs four hours of GPU per clip and the released code has no licence.

GANimator (Li, Aberman, Zhang, Hanocka, Sorkine-Hornung, SIGGRAPH 2022) learns to synthesise novel, non-repeating motion from one input sequence of 140 to 800 frames at 30 fps (roughly 5 to 27 seconds), for bipeds, quadrupeds and hexapods, and their own examples draw on Truebones. Training takes about 4 hours on an RTX 2080 Ti for a 600-frame human sequence and scales with sequence length. They describe an interactive-generation scheme that keeps only the frames inside the receptive field, so it can be driven by user trajectory input rather than only sampled offline. The catch for this repo: GitHub reports no detectable licence on `PeizhuoLi/ganimator` (SPDX `NOASSERTION`), meaning the terms of reuse are undefined rather than permissive.

- Source: https://arxiv.org/pdf/2205.02625 , https://api.github.com/repos/PeizhuoLi/ganimator
- Date: 2022-05-05 / fetched 2026-09-10
- Confidence: high
- Runs on device: ios-no for training; inference untested on device

### Diffusion character controllers reached real time in 2024, but only on a desktop GPU, and only for humans.

CAMDM (Chen et al., SIGGRAPH 2024) is a transformer conditional autoregressive motion diffusion model that takes 10 frames of past motion and generates 45 frames of future motion at 30 fps, using 8 denoising steps at runtime rather than the usual hundreds. Reported cost is 8–13 ms per frame on an RTX 3060, "over 60 frames per second", from a 20 MB ONNX file, trained for ~20 hours on an A100 over the 100STYLE dataset (4 million frames, 100 styles). It is bipedal locomotion on flat ground only. 8–13 ms on a discrete desktop GPU is one to two orders of magnitude more expensive than the MoE controllers, and there is no quadruped version.

- Source: https://arxiv.org/html/2404.15121
- Date: 2024-04-23
- Confidence: high
- Runs on device: ios-no

### The 2026 state of the art is a single generative backbone covering 350,000 motion clips at 2 ms latency, and it is humanoid-only and GPU-resident.

NVIDIA's MotionBricks (SIGGRAPH 2026) is a modular latent generative backbone trained on the BONES-SEED dataset of over 350,000 production mocap clips, claiming 15,000 FPS and 2 ms latency, with a plug-and-play "smart primitives" authoring layer on top and a preview code release inside NVIDIA's GR00T whole-body-control stack. The project page discloses neither the hardware behind the 15,000 FPS figure nor a parameter count, and the entire framing — G1 humanoid robot, human mocap — is bipedal. It is the right thing to watch and the wrong thing to build on for a cat on a tablet.

- Source: https://nvlabs.github.io/motionbricks/ , https://research.nvidia.com/labs/dair/publication/motionbricks2026/
- Date: 2026-07 / fetched 2026-09-10
- Confidence: medium (the FPS claim has no disclosed hardware)
- Runs on device: ios-no

### Animation Inc publishes exactly one technical number and no paper, no patent and no talk — the shape of the technology has to be inferred from the number itself, and the number rules out most candidates.

Their site claims a proprietary "Ani-2 Model" generating "full-body 3D motion in real-time", "on-device", with "No motion capture, no cloud, no delay", at 2.5 ms/frame, taking voice, text, inferred emotional state and claimed biometric signals (breathing rhythm, fatigue) as input. Team: Sergey Gonchar (CEO), Eugene Zatepyakin (CTO), Eugene Nevgen (CSO), Andrew Yanchurevich (CPO), Dmitry Doryn (art director); 13 people across Warsaw, Limassol and Palo Alto; backed by Elefund, DVC, Haystack. The founders' prior work is MSQRD (face filters, acquired by Meta), Meta Spark, the Meta face tracker, and Loóna. They shipped a separate 17+ companion app, Animates, on 2026-08-28, Android first. What the 2.5 ms figure implies: it is 3 to 10 times the cost of a MANN-class controller and roughly a quarter of a 60 Hz frame on a phone, which is consistent with an autoregressive feed-forward or small transformer network producing skeletal parameters per frame, and inconsistent with a multi-step diffusion sampler or any pixel/video generation. "No motion capture" is a marketing claim about the runtime, not necessarily about training. Their claimed distinguishing feature — driving idle behaviour and gesture from conversation context rather than from a trajectory goal — is precisely the input signal the graphics lineage does *not* have, and is the actually novel part.

- Source: https://www.animation.inc/ , https://pocketanimus.com/guides/animates-app/
- Date: fetched 2026-09-10
- Confidence: medium for the inference, high for the quoted claims
- Runs on device: unknown (their claim, unverified)

### For a stylized cat that mostly sits beside a page, a learned controller buys nothing real over a procedural one — the thing it is good at is exactly the thing this pet does not do.

What a MANN/LMM-class controller genuinely provides is physically plausible four-legged *locomotion*: contact timing, weight shift, gait transition at the right speed, limb coordination that is genuinely hard to hand-author. Its main input is a desired ground trajectory. A pet that sits in a corner of a reading app has no trajectory; its states are idle, listening, thinking, speaking, has-something-to-say and reacting to touch, none of which is locomotion and none of which appears in any public quadruped dataset. Meanwhile the property the founder actually asked for — never repeating — is a property of the *input signal*, not of the model class: a controller fed continuous noise never repeats whether it is a neural network or a spring. The lineage's own architecture history supports this reading: PFNN's non-repetition came from a hand-written phase variable and MANN's from foot velocity, both of which are cheap deterministic signals a procedural rig also has. Precedent for the procedural side is old and shipped: Spore (Hecker et al., SIGGRAPH 2008) animated user-created creatures with morphologies that did not exist when the animation was authored, in real time, on 2008 console hardware, with no learned model. The honest recommendation is a hybrid where the learned part is deferred: procedural body first, learned locomotion layer only if the cat has to walk.

- Source: https://www.chrishecker.com/images/c/cb/Sporeanim-siggraph08.pdf , https://www.pure.ed.ac.uk/ws/portalfiles/portal/60838109/dog2.pdf
- Date: 2008-08 / 2018-08
- Confidence: medium (the judgement is mine; the supporting facts are sourced)
- Runs on device: ios-yes

### CoreML is the worst of the three deployment paths — the Apple Neural Engine charges a 0.23 ms floor on every dispatch no matter how small the work, so a network this size is pure overhead.

Bryngelson's 2026 measurement study of the ANE, measured on M1 and M5 silicon: "Every dispatch pays a fixed minimum cost regardless of the work it holds. On the M1 that floor is about 0.23 ms per evaluation. A relu, sigmoid, average pool, and small convolution are all at 0.23 to 0.26 ms, and a 64-element linear is 0.23 ms: below the floor, neither the operation nor its size matters." A decomposition of a tiny model puts about 98% of the call in dispatch overhead, with ~0.13 ms of that being the firmware round trip. The roofline also has a 2 MB working-set threshold and a ridge at 141 FLOP per byte; an 11 MFLOP network reading 22 MB of weights is nowhere near either. So routing a MANN-sized controller through the existing Swift plugin would cost 0.23 ms of ANE dispatch plus a per-frame IPC hop across the WebView boundary, to replace arithmetic that the WebView's own CPU does in about the same time.

- Source: https://arxiv.org/pdf/2606.22283
- Date: 2026-06 / fetched 2026-09-10
- Confidence: high
- Runs on device: ios-yes (but pointless at this size)

### If a real network does land, use ONNX Runtime Web's plain WASM backend and specifically not its WebGPU path — the WebGPU path currently crashes WebKit 26 on iOS.

Microsoft's own issue tracker carries an open report (opened 2025-12-18, ONNX Runtime Web 1.20.0 through 1.23.2) that JSEP mode — the WebGPU execution provider — leaves Safari/WebKit 26 pinned at 400%+ CPU with memory at 1 GB and climbing past 14 GB after inference finishes, crashing the content process on iOS. Root cause is traced to looping in WebKit's JS engine stack allocator during WebAssembly compilation. The report is explicit that the plain WASM backend and other browsers are unaffected. WebGPU itself did ship on iOS/iPadOS 26 with Safari 26.0 in September 2025, so the capability exists; the runtime on top of it does not work yet. The plain WASM path is also the right default for a small model anyway: the marshalling overhead of a GPU round trip exceeds the compute for a network of this size, and the repo already sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so `SharedArrayBuffer` and WASM threads are available without further work.

- Source: https://github.com/microsoft/onnxruntime/issues/26827 , https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ , `src-tauri/tauri.conf.json:22-26`
- Date: 2025-12-18 / 2025-06 / fetched 2026-09-10
- Confidence: high
- Runs on device: ios-yes for the WASM backend, ios-no for JSEP

### Plain TypeScript in the WebView is very likely enough, and the only published native-versus-WASM penalty is a factor of 1.5, not a factor of ten.

The reference measurement is Jangda, Powers, Berger and Guha, USENIX ATC 2019: WebAssembly runs the SPEC CPU suite on average 45% slower than native in Firefox and 55% slower in Chrome, with worst cases of 2.08× and 2.5×. Applying the worst case to MANN's measured 2.44 ms/frame on a 2020 Xeon gives about 6 ms in a WebView on comparable silicon, and at the 10 Hz prediction rate Meta's controller actually uses, about 60 ms per second of animation — under 6% of one core. Two caveats: the study predates WASM SIMD and did not test Safari, and none of these numbers is a measurement on an iPad. The narrow conclusion that holds is that no exotic runtime is needed to make the arithmetic fit.

- Source: https://www.usenix.org/conference/atc19/presentation/jangda
- Date: 2019-07
- Confidence: medium (transfer to Safari on A-series is an inference)
- Runs on device: ios-yes

## Numbers

### PFNN model size and per-frame cost

10 MB of weights, 1.8 ms/frame with the phase spline evaluated at runtime, 1.4 ms with 10 precomputed samples and linear interpolation (25 MB), 0.8 ms with 50 precomputed samples (125 MB). Intel i7-6700 3.4 GHz, single-threaded. Three layers of 512 ELU units, four cyclic control points, 31 joints, ~1 hour of raw mocap at 60 fps, ~30 hours of training on a GTX 660.

- Source: https://www.pure.ed.ac.uk/ws/files/35467734/phasefunction.pdf
- Date: 2017-07

### MANN dog controller size and per-frame cost

~22 MB with 8 expert weight sets, ~2 ms/frame single-threaded on an Intel Core i7 via a port of Eigen, in Unity. Hidden layers 512, gating network 32 units reading 19 input dimensions (foot positions and velocities), 27 bones, 81 DoF. Training 20 hours (4 experts) or 30 hours (8 experts) on a GTX 970. Input 480 dimensions and output 363 (derived from the paper's feature list and cross-checked against the 22 MB figure: 8 × 695,147 parameters × 4 bytes = 22.2 MB).

- Source: https://www.pure.ed.ac.uk/ws/portalfiles/portal/60838109/dog2.pdf
- Date: 2018-08

### The dog dataset, in full

30 minutes of unstructured dog mocap, doubled by mirroring, on flat terrain only. Breakdown by seconds/frames/share: idle 1614.37 s / 96,862 / 36.42%; locomotion 1828.70 s / 109,722 / 41.25%; jump 30.27 s / 1,816 / 0.68%; sit 497.93 s / 29,876 / 11.23%; lie 397.13 s / 23,828 / 8.96%; stand 64.83 s / 3,890 / 1.46%. Four locomotion modes: walk, pace, trot, canter. Licence CC BY-NC 4.0; downloadable as `MotionCapture.zip` from starke-consult.de.

- Source: https://www.pure.ed.ac.uk/ws/portalfiles/portal/60838109/dog2.pdf , https://raw.githubusercontent.com/sebastianstarke/AI4Animation/master/README.md
- Date: 2018-08 / fetched 2026-09-10

### Learned Motion Matching versus MANN versus Motion Matching, same dog, same machine

Dog scenario, 58 joints, 124,418 frames at 60 Hz. Motion Matching: 136.5 MB, 131 µs/frame. Decompressor-only Motion Matching: 36.3 MB. Learned Motion Matching: 6.5 MB, 262 µs/frame, 23.0 hours training. MANN: 16.9 MB, 2440 µs/frame, 5.9 hours training. PFNN (Terrain scenario): 9.3 MB, 1370 µs/frame. All timings single-threaded on an Intel Xeon 3.5 GHz 12-core with a custom inference library. Networks are 3 to 6 layers of 512 units, ELU or ReLU.

- Source: https://theorangeduck.com/media/uploads/other_stuff/Learned_Motion_Matching.pdf
- Date: 2020-07

### MANN FLOPs per frame and the pruning curve

Dense: 11.10 MFLOPs per frame, 178 Mb of 32-bit floats (22.25 MB). 50% sparsity: 5.89 MFLOPs, 88 Mb. 90% sparsity: 1.74 MFLOPs, 17.8 Mb (2.2 MB). Pruned networks outperform dense networks of the same parameter count on foot-skate.

- Source: https://arxiv.org/abs/2201.04042
- Date: 2022-01-11

### Meta's 2026 pretrained quadruped controller

`Network.pt` 60,224,077 bytes and `Postprocessor.pt` 1,656,644 bytes on GitHub (63,642,234 and 1,656,644 on the Hugging Face demo space). Codebook-matching architecture, trained on the 2018 MANN dog data. Runtime: `SEQUENCE_FPS = 30`, `PREDICTION_FPS = 10`, 16-frame sequence window of 0.5 s, FABRIK plus a dedicated leg-IK pass. Locomotion mode speed thresholds walk 0.7, pace 1.2, trot 2.0, canter 4.0. Ships `Dog.glb` and `Wolf.glb`. Licence CC BY-NC 4.0.

- Source: https://github.com/facebookresearch/ai4animationpy , https://huggingface.co/api/spaces/paulstarke/ai4animationpy
- Date: fetched 2026-09-10

### Truebones Zoo, the only source of cat motion

70 skeletons, 3 to 40 motions each, 1219 motions, 147,178 frames total (~82 minutes at 30 fps across all animals). Benchmark skeletons carry 600 to 1200 frames each, i.e. 20 to 40 seconds per animal. Pay-what-you-want on Gumroad; derived research releases are non-commercial and access-gated.

- Source: https://arxiv.org/pdf/2502.17327
- Date: 2025-02-24

### GANimator, the single-clip path

Input: one sequence of 140 to 800 frames at 30 fps. Training: ~4 hours on an RTX 2080 Ti for a 600-frame sequence, scaling with length. Supports bipeds, quadrupeds and hexapods. Repository licence: none detected (SPDX `NOASSERTION`), 411 stars.

- Source: https://arxiv.org/pdf/2205.02625 , https://api.github.com/repos/PeizhuoLi/ganimator
- Date: 2022-05-05 / fetched 2026-09-10

### CAMDM, the diffusion path

20 MB ONNX, 8 diffusion steps at runtime, 10 frames of history in, 45 frames out, 30 fps motion, 8–13 ms/frame on an RTX 3060, ~20 hours training on an A100, 100STYLE dataset (4 M frames, 100 styles). Human bipedal locomotion on flat ground only.

- Source: https://arxiv.org/html/2404.15121
- Date: 2024-04-23

### Apple Neural Engine dispatch floor

0.23 ms minimum per dispatch on M1, independent of work size; a 64-element linear layer costs the same 0.23 ms as a small convolution. ~98% of a tiny model's call time is dispatch overhead, ~0.13 ms of it firmware round trip. Roofline ridge at 141 FLOP/byte, 2 MB working-set threshold, ~12 fp16 TFLOP/s peak, 0.37 pJ/FLOP at the compute optimum. Measured on M1 and M5.

- Source: https://arxiv.org/pdf/2606.22283
- Date: 2026-06

### WebAssembly versus native

Mean slowdown 45% in Firefox and 55% in Chrome across SPEC CPU; worst case 2.08× and 2.5×. Pre-SIMD, Safari not tested.

- Source: https://www.usenix.org/conference/atc19/presentation/jangda
- Date: 2019-07

### ONNX Runtime Web on WebKit 26

JSEP (WebGPU) mode leaves CPU at 400%+ and memory at 1 GB growing past 14 GB after inference, crashing the content process on iOS. Affects ORT-Web 1.20.0, 1.22.0, 1.23.0, 1.23.2 on Safari 26.2 / macOS 26.2 and the iOS 26 simulator. Plain WASM backend unaffected. Opened 2025-12-18, unresolved.

- Source: https://github.com/microsoft/onnxruntime/issues/26827
- Date: 2025-12-18

### Animation Inc's one public number

2.5 ms/frame, on-device, full-body 3D motion, "Ani-2 Model", no mocap and no cloud at runtime. 13 people. Animates app shipped 2026-08-28, Android first.

- Source: https://www.animation.inc/ , https://pocketanimus.com/guides/animates-app/
- Date: fetched 2026-09-10

### The four options, side by side

| | expresses | data needed | compute/frame | engineering |
|---|---|---|---|---|
| (a) learned controller (MANN/codebook) | plausible quadruped gait, gait transitions, weight shift, sit/lie/jump transitions from the label set it was trained on | 30 min of mocap of *that* animal, or accept a realistic dog | 11.1 MFLOPs, 2.4 ms measured on 2020 desktop CPU, ÷3–6 at 10 Hz prediction | 6–10 weeks, plus export/quantize/renderer, plus a licence problem |
| (b) motion matching over a database | anything in the database, exactly, with the best fidelity of the four; nothing outside it | the same mocap, uncompressed in memory (136.5 MB for the dog) | 131 µs measured, plus the memory | 4–6 weeks, same data problem, memory rules it out on a tablet |
| (c) procedural / stochastic | breath, blink, gaze, ear and tail secondary motion, touch reaction, posture blends, weight shift; never repeats; every parameter directly steerable from app state | none | microseconds; it is a few dozen sines, springs and an IK pass | 2–4 weeks for the rig and the loops, plus the renderer |
| (d) hybrid: procedural body + learned/authored locomotion layer | (c) plus real walking when the cat has to cross the screen | none up front; mocap only if and when locomotion is added | (c) until the layer is added | (c) now, (a) or (b) later, and the interface between them is a root trajectory |

Compute figures are sourced above. The engineering-week figures are my estimates and are not sourced.

- Source: composite of the rows above
- Date: 2026-09-10

## Rejected

**Neural State Machine (SIGGRAPH Asia 2019) as a candidate.** Its subject is goal-directed scene interaction — sitting on a specific chair, carrying a specific box, opening a specific door. A pet beside a page has no scene to interact with, and the extra machinery is pure cost.

**DeepPhase (SIGGRAPH 2022) as a candidate.** The periodic autoencoder is a representation-learning result that improves other controllers; it is not itself a controller you deploy, and it needs a large unstructured motion dataset to learn phase from — the thing this project does not have for a cat.

**MotionBricks (NVIDIA, SIGGRAPH 2026).** Humanoid-only, GPU-resident, undisclosed hardware behind the 15,000 FPS claim, preview code inside a robotics stack.

**CAMDM and diffusion controllers generally.** 8–13 ms/frame on a discrete desktop GPU is one to two orders above the MoE controllers, and there is no quadruped version. Diffusion buys diversity, which noise buys for free here.

**AnyTop.** The right paper for "a cat with almost no data" and the wrong runtime: 100 denoising steps, offline, on an RTX 2080 Ti.

**Physics-based RL controllers (ASE, CALM, ProtoMotions, and the quadruped-robot line).** The robot policies are genuinely tiny — MLPs of [512, 256, 128] running at 100 Hz on an Atom-class onboard board — but they output joint torques for a rigid-body simulator, so adopting one means shipping a physics engine into the WebView and tuning a reward function to get a *stylized* gait, which is the hardest way to buy style. The graphics-side RL controllers (ASE/CALM) are humanoid and GPU-trained.

**Video and pixel generation.** Already rejected by the founder, and `docs/45` already carries the numbers.

**Contacting Animation Inc.** Out of scope by instruction; nothing here required it.

## Gaps

**No measurement on an iPad.** Every per-frame number in this file is from an Intel desktop CPU, an NVIDIA GPU, or an Apple laptop-class chip. The transfer to an A-series or M-series iPad inside WKWebView is arithmetic and inference, not measurement. The cheap probe that would close it: export the MANN forward pass (or any 480→512→512→363 MLP with 8-way weight blending) to ONNX, run it in ORT-Web's WASM backend in the app's own WebView, and time 10,000 frames.

**DeepPhase runtime and model size.** Could not retrieve the paper's performance table; the ACM page is paywalled and no accepted-manuscript PDF surfaced at the Edinburgh or HKU repositories within budget.

**Neural State Machine's exact size and per-frame cost.** Not retrieved; only the qualitative description from the repository ReadMe.

**Whether any quadruped controller has ever been exported to ONNX and run in a browser.** CAMDM is deployed via ONNX but is human. Meta's AI4AnimationPy web demos are Docker-hosted and stream from a server; the quadruped weights are a 60 MB PyTorch checkpoint, not a browser artifact. So there is no precedent to point at, in either direction.

**Animation Inc's actual architecture.** No paper, no patent traceable to the named founders, no conference talk, no job posting with technical requirements was found. The 2.5 ms/frame figure and the "no motion capture, no cloud" phrasing are marketing copy from their own site. Everything in the finding above beyond those quotes is inference from the number and from the founders' computer-vision background.

**The exact frame count of the cat in Truebones Zoo.** AnyTop confirms a cat skeleton exists and is used for zero-shot evaluation, but does not print its per-skeleton frame count; the 600–1200 range is the benchmark's selection criterion, not the cat's measured length.

**Whether CC BY-NC 4.0 mocap can be shipped inside a PolyForm-NC app.** The two are both non-commercial and the data licence permits redistribution with attribution, so this probably works, but it is a licence-compatibility question that has not been checked by anyone qualified, and the surrounding AI4Animation code carries a stricter "no redistribution" notice that definitely does not permit vendoring.
