# Round 3 / 2 — The cat's body: rigs, motion data and asset pipeline

> 第三轮调研，2026-09-10 跑。维度原题：where the cat's body and its motion data come from — quadruped/cat motion datasets and their licenses, monocular animal capture as a way to make our own motion data, the four candidate rig runtimes for a 30–60 Hz external parameter stream, ready-made stylized cat rigs on the marketplaces, and whether 2026 changed round 1's "image-to-3D outputs a static mesh with no skeleton".
>
> 前提已变：创始人否掉了 authored/canned animation。目标是一只风格化小动物（猫科，非人非写实），运动由 iPad 上一个小控制器在运行时生成，输出 rig 参数（骨骼/blendshape）。像素级视频生成不在范围内。
>
> 每条保留来源 URL、抓取日期和置信度。未核实的明确标注。

---

## Headline

There is no cat mocap you can have: the only real quadruped capture that is both substantial and obtainable is 30 minutes of dog under CC BY-NC 4.0 (MANN) plus a purchasable artist-animated zoo (Truebones, ~$99 or pay-what-you-want, 1,219 clips / 147,178 frames across 70 skeletons, cat and lynx among them) whose license lets you train on it and ship the weights but forbids shipping the clips — and since this repo is already PolyForm-NC, the non-commercial half of that constraint costs nothing today and everything on the day it earns money. The realistic way to get cat-shaped motion is MoCapAnything V2 (SIGGRAPH Asia 2026, MIT code *and* weights, arXiv 2604.28130), which takes a monocular video plus **your own** reference skeleton and emits BVH joint rotations at ~6.5° rotation error on unseen skeletons — it retargets at capture time, so YouTube cat footage lands directly on the rig you built, with the caveat that it works in camera space with no contact or world-grounded root. For the body itself, a 3D skinned glTF cat rendered by three.js in the WebView is the only one of the four candidates that takes an arbitrary 20–60-channel parameter stream without fighting the runtime's own state machine, and it is also the cheapest to author and to license; WebGL2 is the floor and it is enough, because WebGPU in WKWebView is still unconfirmed and Apple's last on-record answer (DTS, April 2025) was "not supported". The license trap is the marketplace: a $5–20 rigged stylized cat from Unity Asset Store, Fab or Sketchfab is legally unshippable in a *public* repo, because every one of those licenses forbids distributing the asset in a form third parties can extract — the same shape as the Live2D Core problem from round 1, but with no `bun run wasm` escape hatch, since there is no public upstream to fetch from. The two clean paths are CC0 (Quaternius' Ultimate Animated Animals: 12 quadrupeds, 12+ animations each, no cat but a fox, a wolf, a husky and a shiba) and Meshy's free tier, whose generated assets are CC BY 4.0 forever. And round 1's conclusion has expired: UniRig (SIGGRAPH 2025, MIT code and MIT weights, trained on 14k rigged assets including quadrupeds) auto-rigs a static mesh into skeleton plus skinning weights on an 8 GB GPU, and AniGen (arXiv 2604.08746, April 2026) generates geometry, skeleton and skinning weights together from one image.

## Relevance to this repo

The decision this dimension actually forces is *who owns the cat*, and the answer that survives both the public-repo constraint and the runtime constraint is: we generate or commission the mesh, we auto-rig it with UniRig, and we capture its motion ourselves from video. Everything bought off a marketplace dies on the same clause — Fab's Standard License permits sharing "directly, via a private repository, or in the Project with collaborators", Unity's Asset Store Terms §3.5 forbids distributing an Asset at all, and Sketchfab's Standard License forbids making the material available "in a way that allows third parties to use, download, extract or access" it as a stand-alone file. A public source-available repo is precisely the prohibited form. Round 1 already solved this shape once for Live2D by gitignoring the artifact and fetching it at build time, but that worked only because Live2D hosts the Core publicly; a $19.99 Unity cat has no public URL to fetch from, so the workaround does not transfer. That leaves CC0, CC BY 4.0 (Meshy free tier, attribution in the repo), or our own asset — and our own asset is now cheap, because the auto-rig gap that round 1 identified closed in 2025. On the motion side the repo's PolyForm-NC posture is a genuine asset rather than a liability: CC BY-NC 4.0 mocap (MANN's 30 minutes of dog) and CC BY-NC research datasets are usable for a non-commercial app, and Truebones' terms are unusually friendly (royalty-free, commercial permitted, only redistribution of the FBX/BVH banned), so a model trained on Truebones and shipped as weights inside the app is the one route that stays legal even if the app later goes commercial. The runtime choice is nearly forced by the parameter-stream requirement: Rive and Live2D are both built around *their* timelines and *their* state machines being the source of truth, and driving 40 bones from outside them is swimming upstream, whereas a three.js skinned mesh is literally a `bone.quaternion.set()` loop — and the 168 kB gzipped three.js core is a fifth of the 2.0 MB `rive.wasm` that round 1 priced for feathering, on top of the app's existing 4.63 MB `pdfium.wasm`. The native RealityKit-over-WebView option is architecturally available (a Tauri iOS plugin can find the key window and insert a native view; `tauri-plugin-ios-glass-tabbar` does exactly that), and SceneKit is soft-deprecated as of WWDC25, so the native branch means RealityKit and means writing Swift the repo would then have to keep compiling with `scripts/ios-swiftcheck.sh` — a second rendering stack for a mascot, against `docs/45`'s whole cost argument. Two facts from round 1 carry over unchanged and both favour 3D: `requestAnimationFrame` is capped at 60 Hz in WKWebView (so a 30–60 Hz controller is exactly matched, and there is no reason to build for more), and decoded-bitmap memory is what kills a WKWebView content process — a 5–10k-triangle skinned cat with one 1024px texture is ~4 MB of decoded RGBA, two orders of magnitude under the 327 MB sprite-sheet figure that killed that option.

## Findings

### The only substantial real quadruped mocap that a non-commercial project can actually obtain is 30 minutes of dog, and it is CC BY-NC 4.0 — which this repo's own licence already matches.

Zhang, Starke, Komura and Saito's *Mode-adaptive neural networks for quadruped motion control* (SIGGRAPH 2018) trained on 30 minutes of dog motion capture. The data is not in the AI4Animation repository; the SIGGRAPH_2018 folder holds only TensorFlow and Unity subfolders and a ReadMe pointing at a separate `MotionCapture.zip` download. The repository's own terms are two-layered: "This project is only for research or education purposes, and not freely available for commercial use or redistribution", while the motion capture data specifically is under Attribution-NonCommercial 4.0 International (CC BY-NC 4.0). CC BY-NC does permit redistribution with attribution for non-commercial purposes, so a PolyForm-NC repo is not obviously excluded — but the repo-level sentence says otherwise, and the two are in tension. The practical reading: train on it, do not vendor it, and treat the day the app monetises as the day this dataset has to be removed from the pipeline. 30 minutes is also small: it is a locomotion set (walk/trot/pace/sit), not an expressive-idle set, and it is a dog, not a cat.

- Source: https://github.com/sebastianstarke/AI4Animation and https://dl.acm.org/doi/10.1145/3197517.3201366
- Date: 2026-09-10
- Confidence: high
- Runs on device: n/a (training data)

### Truebones Zoo is the de facto animal-motion corpus behind every skeleton-agnostic 2025–2026 method, it contains a cat, and its licence permits shipping a model trained on it but not the clips.

Truebones Zoo is what AnyTop (SIGGRAPH 2025), MoCapAnything (CVPR 2026 / SIGGRAPH Asia 2026) and the T2M4LVO caption set all train on, and every one of them declines to redistribute it. AnyTop reports 70 skeletons, 1,219 motions and 147,178 frames, 3 to 40 motions per skeleton, spanning mammals, birds, insects, dinosaurs, fish and snakes; its qualitative figures name cat, lynx, fox, dog, bear, raptor and others, so a cat skeleton with its own rest pose and clip set is in there. MoCapAnything's filtered subset is 1,038 sequences / 104,715 frames, split 978 train / 60 test. Truebones' own terms are the friendliest in this whole dimension: "absolutely royalty free and can be used for any and all purposes even commercial, including movies, animations, games, VR, AR, research, and education", with credit requested — and one hard prohibition: "Re-distribution or resale of Truebones in .FBX, .BVH or i-Motion formats is strictly prohibited". Nothing in those terms forbids training on it. So the shippable artifact is the controller's weights, never the clips, and the repo must gitignore the corpus the way it already gitignores pdfium.

- Source: https://arxiv.org/pdf/2502.17327 ; https://arxiv.org/html/2512.10881v2 ; https://truebones.gumroad.com/p/reminder-truebones-terms-of-use-and-service ; https://truebones.gumroad.com/l/skZMC
- Date: 2026-09-10
- Confidence: high (stats and terms), medium (that the cat clips are numerous enough to matter — per-species clip counts not published)
- Runs on device: n/a (training data)

### QuadFM is the first quadruped motion corpus at CC BY 4.0 and 20.27 hours, but it is dog-only, robot-shaped, and as of today not actually released.

QuadFM (arXiv 2603.24021, 2026-03-25) is 11,784 curated clips, 20.27 hours, 3.64M frames normalised to 50 Hz, with 35,352 three-layer text annotations. It is assembled from four sources — real dog mocap of fundamental gaits, AI-generated canine video passed through animal pose estimation, artist keyframe animation, and teleoperation logs from real quadruped robots — then kinematically retargeted and RL-corrected for robot execution, with a 12-DoF joint representation. The paper promises release under CC BY 4.0, which would make it the only large animal-motion set that is redistributable and commercially usable. Checked 2026-09-10: the repository exists with an Apache-2.0 licence file and a README that says only "QuadFM will be released soon" — no data. Even when it lands, 12 DoF is four legs and nothing else: no tail, no ears, no spine bend, no head-neck chain, which are most of what makes a cat read as a cat.

- Source: https://arxiv.org/html/2603.24021 ; https://github.com/GaoLii/QuadFM
- Date: 2026-09-10
- Confidence: high
- Runs on device: n/a (training data)

### Real cat mocap has been captured, at 120 Hz with twelve Vicon cameras, and never released; what Artemis actually published is nine CGI animals.

The ARTEMIS project (SIGGRAPH 2022) built a capture stage for dogs and cats: 12 Vicon Vantage V16 cameras evenly distributed around the animal tracking IR markers at 120 Hz, interleaved with 22 Z-CAM cinema cameras at 1920×1080 / 30 fps, and the paper describes the resulting animal mocap dataset as intended for release to the research community. What is downloadable is the DFA (Dynamic Furry Animal) dataset: nine *CGI* furry animals — a cat among them — with 36-camera multi-view renderings, skeletal motions, volumetric representations with bone indices and skinning weights, hosted on a ShanghaiTech SharePoint with restricted access and no published licence. This is the pattern across the field: the marker data stays in the lab, the artist-authored data is what circulates.

- Source: https://arxiv.org/abs/2202.05628 ; https://github.com/HaiminLuo/Artemis
- Date: 2026-09-10
- Confidence: medium (Vicon rig details are from search-surfaced paper text, not a direct read of the PDF, which exceeded the fetch size limit)
- Runs on device: n/a

### Every SMAL-derived asset is unusable for anything that ships, and that disqualifies most of the animal-pose literature at the last step.

The SMAL licence from Max Planck is explicit on all three axes that matter: "Any other use, in particular any use for commercial purposes, is prohibited"; "The Software and the license herein granted shall not be copied, shared, distributed, re-sold, offered for re-sale, transferred or sub-licensed in whole or in part"; and it forbids training "methods/algorithms/neural networks/etc. for commercial use of any kind". Derivative works are permitted but inherit the restrictions. That taints BITE (D-SMAL), Animal Avatars, 4D-Animal, AniMer/AniMer+ (MIT code, but the model it regresses is SMAL), Animal3D (3,379 images from 40 mammal species annotated with 26 keypoints *and SMAL pose/shape parameters*), and SAM 3D Animal (SMAL+, 145 species, arXiv 2605.07604, 2026-05-08, single-image only, no code or licence announced). For a non-commercial repo the commercial clause is dormant today, but the redistribution clause is not — the model file itself can never enter the repo — and the whole family becomes a dead end the moment the app monetises. The way around it is not to negotiate: it is to pick a method that never touches SMAL.

- Source: https://smal.is.tue.mpg.de/license.html ; https://arxiv.org/abs/2308.11737 ; https://arxiv.org/html/2605.07604
- Date: 2026-09-10
- Confidence: high
- Runs on device: server-only

### MoCapAnything V2 is the pipeline that turns cat video into rig-native motion, it is MIT in both code and weights, and it retargets at capture time instead of afterwards.

MoCapAnything takes a monocular video plus a reference skeleton — "either provided example rigs or bring custom rigged FBX files" — and outputs BVH-ready joint rotations plus `.npy` pose files, with no SMAL and no mesh intermediate. That inverts the usual pipeline: instead of capturing into some canonical animal skeleton and retargeting to our cat, we hand it *our* cat's skeleton and it captures directly onto it. V1 (arXiv 2512.10881, CVPR 2026) reports MPJPE of 1.06 cm on seen species, 1.28 cm on rare, 1.76 cm on unseen, normalised to a 1 m³ cube; V2 (arXiv 2604.28130, submitted 2026-04-30, revised 2026-06-19, SIGGRAPH Asia 2026) cuts rotation error from ~17° to ~10°, and to 6.54° on unseen skeletons, and claims ~20× faster inference than mesh-based pipelines. Code and weights are MIT on GitHub and Hugging Face with a live demo; the caveats in the repo are that preprocessing pulls in RMBG-1.4 (BRIA AI, its own terms) and that the Truebones training data is not redistributed. Training was 8 GPUs × 64 GB for ~36 hours, which is the cost of *making* it, not of using it.

- Source: https://github.com/phongdaot/MocapAnything ; https://arxiv.org/abs/2604.28130 ; https://arxiv.org/html/2512.10881v2 ; https://animotionlab.github.io/MoCapAnything/
- Date: 2026-09-10
- Confidence: high (licence, I/O, accuracy), low (per-video runtime and VRAM — not published)
- Runs on device: server-only (offline authoring step; nothing ships)

### What monocular animal capture in 2026 still does not give you is world-grounded root motion or foot contact, and that is the half a companion cat needs least.

The authors state the limitation plainly: the method "depends on the quality of the pretrained image-to-3D reconstructor and assumes access to a rig with known joint structure; it also operates primarily in camera space without explicit physics or contact reasoning", with world-grounded trajectory recovery and contact-aware IK listed as future work. For a locomotion controller that has to plant feet on terrain, that is fatal and you would be back to physics-based cleanup. For a cat that sits in a corner of the reading view, breathes, blinks, flicks its tail, turns its head, stretches and curls up, camera-space local joint rotations are the entire product — the root barely moves, and the one contact that matters (haunches on the floor) can be enforced by a single hand-authored constraint. This is the argument for making the companion sedentary by design.

- Source: https://arxiv.org/html/2512.10881v2
- Date: 2026-09-10
- Confidence: high
- Runs on device: server-only

### A 3D skinned glTF cat in three.js is the only one of the four runtimes that takes an arbitrary 20–60-channel parameter stream without fighting the runtime's own timeline.

The requirement is that an external controller, not a state machine, owns the pose every frame. In three.js that is the native shape of the API: load a `.glb`, walk `skeleton.bones`, write a quaternion per bone per frame, done — no editor concept has to be subverted, and the number of channels is whatever the skeleton has. three.js is also the smallest of the candidates at ~168.4 kB minified+gzipped for v0.175.0, against ~1.4 MB for Babylon.js v8.1.1 — and against the 2,004,858 B `rive.wasm` + 413,126 B `rive.js` that round 1 measured for the feathering-capable `@rive-app/webgl2` build. A glTF skinned mesh caps at 4 joint influences per vertex, which is standard and adequate for a stylized quadruped; morph targets are available in the same file if the controller also wants blendshape channels for the face. Draw calls, not triangles, are the mobile constraint — under 100 draw calls holds 60 fps on most devices — and a single-material cat is one or two draw calls.

- Source: https://www.pkgpulse.com/guides/threejs-vs-react-three-fiber-vs-babylonjs-3d-webgl-2026 ; https://www.utsubo.com/blog/threejs-best-practices-100-tips ; round1-02 measurements for the Rive figures
- Date: 2026-09-10
- Confidence: medium (bundle sizes are from a secondary comparison page, not measured from unpkg as round 1 did)
- Runs on device: ios-yes

### WebGPU in WKWebView on iPadOS 26 is unresolved, and the honest plan is WebGL2 with feature detection.

WebGPU ships enabled by default in Safari 26.0 for macOS, iOS, iPadOS and visionOS, and WebKit's announcement names Babylon.js, Three.js, Unity and PlayCanvas as working against it — but that post says nothing about WKWebView, and caniuse tracks only the browser (iOS Safari 26.0 supported; 17.4–18.7 disabled by default). The one on-record Apple answer is a DTS engineer in April 2025 responding to "there is still no support for WebGPU via WebView" with "we're unable to share any public roadmaps"; caniwebview.com lists iOS WKWebView WebGPU as "support unknown"; and a 2026 compatibility survey states flatly that Android WebView and iOS WKWebView do not ship WebGPU on by default, so hybrid apps need a WebGL2 or native fallback. This is cheaply settled by running `navigator.gpu !== undefined` inside the app's own WKWebView on an iPad — one line, and worth doing before anyone designs around it. Nothing in this dimension needs WebGPU: a skinned cat is a WebGL2-era workload.

- Source: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ ; https://developer.apple.com/forums/thread/781602 ; https://caniwebview.com/features/web-feature-webgpu/ ; https://caniuse.com/webgpu
- Date: 2026-09-10
- Confidence: medium (the negative is well-attested but no 2026 first-party statement exists either way)
- Runs on device: ios-unknown

### Rive can be driven from outside — it has real bones and weighted mesh deformation, and data binding accepts numbers — but the runtime is designed around its state machine owning the pose, and nobody publishes the cost of pushing dozens of bindings per frame.

Rive's bones do all three things a rig needs: parent shapes for rigid movement, bind vector path vertices and Bézier handles with weighted influence, and deform meshes attached to raster images, with per-vertex weights that sum to 100% and auto-weighting tools. Data binding exposes text, number and boolean properties on a ViewModel that the host application writes at runtime, with converters such as `DataConverterRangeMapper` for remapping numeric ranges, and a dirt-flag propagation system for updates. So a 40-channel stream is expressible. What is missing is any published guidance on setting values every frame, any documented cap on bone count, and any performance figure for feathering — round 1 already noted Rive gives no numbers there, only "hyper-performant on lower-end hardware". The deeper mismatch is conceptual: Rive's value is the state machine, the timelines and the editor-authored transitions, which is exactly the authored animation the founder has now rejected. Paying 2.4 MB of runtime to bypass the feature you are paying for is the wrong trade.

- Source: https://rive.app/docs/editor/manipulating-shapes/bones ; https://rive.app/docs/scripting/data-binding ; https://rive.app/docs/runtimes/data-binding
- Date: 2026-09-10
- Confidence: medium
- Runs on device: ios-yes

### Live2D's parameter API is the most literal fit for a parameter stream of the four, and its free editor tier caps at exactly 30 motion parameters — but the licence still bars it from this repo.

The Cubism model update loop is precisely "set parameters, then update": `CubismModel.setParameterValueById()` with overwrite, add or multiply semantics, followed by `CubismModel.update()`, with the explicit rule that parameter writes after `update()` are ignored. There is no timeline to bypass; a controller writing 30 floats per frame is the intended usage, and the Core is remarkably small at 207,155 B raw / 61,392 B gzipped compiled JavaScript, sidestepping the CSP and COEP questions that wasm raises. Two things kill it anyway, both established in round 1 and unchanged: the FREE editor tier allows 30 motion parameters and 3 blend-shape parameters (the low end of the 20–60 target, so a rich cat needs PRO at ¥14,280 first year), and neither the Cubism Core nor the Cubism Framework may be committed to a public source-available repository, with no Linux editor build. A 2D cat also has a specific artistic problem a 2D anime bust does not: a quadruped in three-quarter view has four limbs that cross the body and a tail that orbits it, and 2D mesh deformation cannot rotate a limb behind the torso.

- Source: https://docs.live2d.com/en/cubism-sdk-manual/parameters/ ; https://docs.live2d.com/en/cubism-sdk-manual/use-framework-web/ ; round1-02 for the tier limits and licence
- Date: 2026-09-10
- Confidence: high
- Runs on device: ios-yes

### A native RealityKit view above the WebView is architecturally available in this Tauri app, and SceneKit is soft-deprecated as of WWDC25 — so the native branch costs a second rendering stack and more Swift.

Tauri's iOS target creates the UIWindow and WKWebView from Rust with no Swift view controller, but a plugin can find the key window at runtime and insert native UI into it; `tauri-plugin-ios-glass-tabbar` is a shipped crate that does exactly this for a UITabBar, so the precedent for a transparent 3D view pinned over the reading surface exists. RealityKit runs outside AR with `arView.cameraMode = .nonAR` and a paused session, and transparency in a UIKit host is reachable via `preferredContainerBackgroundStyle` returning `UIContainerBackgroundStyleHidden`. The framework choice is forced: at WWDC25 Apple put SceneKit into critical-bug-only maintenance with no new features and recommended RealityKit for new work. Against that, this repo's Swift surface today is one audio plugin, verified by a four-second `scripts/ios-swiftcheck.sh` type check that "only manages types, not runtime, linking and signing" — a second native renderer means every rig change becomes a Swift change with no test coverage, for a mascot. The one thing native buys that the WebView cannot is escaping the 60 Hz `requestAnimationFrame` cap, and a cat does not need 120 Hz.

- Source: https://crates.io/crates/tauri-plugin-ios-glass-tabbar ; https://developer.apple.com/videos/play/wwdc2025/288/ ; https://developer.apple.com/forums/thread/134001 ; https://developer.apple.com/forums/thread/781945 ; CLAUDE.md for the swiftcheck constraint
- Date: 2026-09-10
- Confidence: medium
- Runs on device: ios-yes

### A rigged stylized cat costs $5 to $20 on the marketplaces, and every one of those licences forbids the one thing this repo does: publish the file.

The assets exist and are cheap. Unity Asset Store: *Flat World – Cats – Rigged & Animated* at $4.99, 1.6 MB, URP-only, Standard Unity Asset Store EULA, Extension Asset, Single Entity; *Cat Kitty Animated* at $19.99, 21.9 MB, built-in/URP/HDRP, v1.1 released 2025-09-16. Sketchfab Store: *Cat Low poly Animated Rigged*, 3,408 polygons / 3,392 vertices, 18 animations (run, idle, jump, leap, skid, roll, dizzy, waving, gliding…), textures at 512–4096px, Maya/FBX/OBJ, marked NoAI. CGTrader: a stylized cats pack at $18.00 royalty-free, unrigged. The licences all converge: Fab's Standard License permits sharing "directly, via a private repository, or in the Project with collaborators working on the Project with you"; Unity's Asset Store Terms §3.5 forbids reproducing, copying, distributing or sublicensing an Asset, and §3.8(v) separately forbids using assets to train a machine-learning model without the provider's consent; Sketchfab's Standard License forbids making the material available "in a way that allows third parties to use, download, extract or access the Licensed Material as a stand-alone file (or group of files)". A public git repo is that exact prohibited form, and unlike Live2D's Core there is no public upstream URL to fetch from at build time, so round 1's gitignore-plus-fetch-script workaround does not transfer. Note also that the Unity AI clause and Sketchfab's NoAI tag independently block using these clips to seed a motion-matching database.

- Source: https://assetstore.unity.com/packages/3d/characters/animals/mammals/flat-world-cats-rigged-animated-259763 ; https://assetstore.unity.com/packages/3d/characters/animals/mammals/cat-kitty-animated-181175 ; https://sketchfab.com/3d-models/cat-low-poly-animated-rigged-6a86307d1930450ab822db01006e8ad5 ; https://unity.com/legal/as-terms ; https://sketchfab.com/licenses ; https://dev.epicgames.com/documentation/fab/licenses-and-pricing-in-fab
- Date: 2026-09-10
- Confidence: high (Unity and Sketchfab clauses quoted directly), medium (Fab clause via documentation summary; fab.com/eula returns 403 to automated fetch)
- Runs on device: n/a

### The CC0 corner has no cat, but it has a fox, a wolf, a husky and a shiba inu with twelve-plus animations each — a legally clean quadruped seed database.

Quaternius' *Ultimate Animated Animals* is CC0 public domain, free for personal and commercial use, 12 animals in FBX, OBJ, glTF and Blend, each with more than 12 unique animations (attack, death, kicks, gallops, walk, jump and others), last updated 2022-07-09. The roster is cow, donkey, deer, alpaca, bull, fox, shiba inu, stag, husky, wolf, white horse, horse — no cat, but five canids and cervids whose skeletons are quadruped and whose silhouettes are close enough that a fox rig is a serviceable stand-in for a stylized cat body plan. Being CC0, these can sit in the public repo with no fetch script, be retargeted freely, and be used as training or motion-matching data with no clause to argue about. The separate *Low Poly Animated Animals* pack is 6 animals with death/idle/jump/run/walk, also CC0. What they do not contain is the idle vocabulary a companion needs — no grooming, no curling up, no tail flick, no ear swivel — which is exactly the gap the video-capture route fills.

- Source: https://quaternius.com/packs/ultimateanimatedanimals.html ; https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS
- Date: 2026-09-10
- Confidence: high
- Runs on device: n/a

### Round 1's "image-to-3D outputs a static mesh with no skeleton" has expired: UniRig auto-rigs quadrupeds under MIT, in both code and weights.

UniRig (*One Model to Rig Them All*, SIGGRAPH 2025, VAST AI Research with Tsinghua) predicts a skeleton and per-vertex skinning weights for an arbitrary mesh using an autoregressive skeleton model plus a Bone-Point Cross Attention module, trained on Rig-XL — over 14,000 rigged 3D models spanning bipeds, quadrupeds, birds, insects and static objects. It exports skeletons as FBX and merges skeleton plus weights into rigged GLB or FBX. Both the GitHub repository and the Hugging Face weights are MIT, with no non-commercial clause anywhere; the requirement is a CUDA GPU with at least 8 GB VRAM. Reported gains over prior commercial and academic auto-riggers are 215% on binding accuracy and 194% on animation quality with most models processed in 1–5 seconds, though those figures are the authors' own. This closes the exact gap round 1 identified — TRELLIS and Hunyuan3D give you a mesh, UniRig gives it a skeleton — and both halves are now permissively licensed.

- Source: https://github.com/VAST-AI-Research/UniRig ; https://github.com/VAST-AI-Research/UniRig/blob/main/LICENSE ; https://huggingface.co/VAST-AI/UniRig
- Date: 2026-09-10
- Confidence: high (licence and requirements), low (the 215%/194% improvement claims are unreplicated author figures)
- Runs on device: server-only

### AniGen generates geometry, skeleton and skinning weights together from a single image, covering animals — but its release status is unverified.

AniGen (*Unified S³ Fields for Animatable 3D Asset Generation*, arXiv 2604.08746, submitted 2026-04-09, revised 2026-04-14) produces a fully rigged, skinned, animatable 3D asset directly from one image, generating geometry alongside an articulated skeleton and skinning weights as an integrated output rather than as a post-process, and reports generalisation across animals, humanoids and machinery. The abstract does not state whether code or weights are released or under what licence, and the project page URL in the paper redirects to an address that returned no substantive content when fetched. Treat this as the direction of travel rather than something to build on this quarter; UniRig plus any image-to-3D model is the same capability today with settled licensing.

- Source: https://arxiv.org/abs/2604.08746
- Date: 2026-09-10
- Confidence: low
- Runs on device: server-only

### Meshy's free tier is the only hosted generator whose output licence can legally live in a public repo, and it auto-rigs quadrupeds — but not tails.

Meshy grants free-plan users a CC BY 4.0 licence on generated assets, permanently and irrevocably, which permits commercial use and redistribution with attribution — the one hosted-generator licence compatible with a public source-available repo, needing only a credit line. Paid plans grant private ownership instead, which is *worse* for this use case only in that it removes the CC obligation but adds a "don't publish to the Meshy Community" condition; the free tier's 100 credits per month reset monthly. Its auto-rigger supports "humanoid and quadruped characters" (props, buildings and vehicles cannot be rigged), runs in the browser in under 30 seconds, and exports FBX aimed at Mixamo-compatible libraries. The documented limits are the ones that matter for a cat: models must be close to T-pose or A-pose with clean topology, and it "cannot handle complex custom skeletons (facial expressions, tail physics)", which require manual rigging in Blender or Maya. Tripo's free tier is non-commercial with commercial use starting at the $19.90/month Pro tier, and its quadruped rigs come with no motion library behind them.

- Source: https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models ; https://docs.meshy.ai/en/webapp/guides/3d-model/rigging ; https://help.meshy.ai/en/articles/15696428-what-is-included-on-the-free-plan ; https://www.tripo3d.ai/blog/quadruped-rigging-tools-compared
- Date: 2026-09-10
- Confidence: medium
- Runs on device: server-only

### VRM is not a container for a cat, so the format choice is plain glTF.

The VRM 1.0 specification is built around a required humanoid bone hierarchy — hips, spine and limb bones are mandatory for a conforming model, humanoid bones must be unique, and the only non-humanoid flexibility is inserting extra nodes *between* humanoid bones. Complete non-humanoid characters are outside the standard. The VRM ecosystem's blendshape and spring-bone conventions are therefore unavailable, and there is nothing to gain by pretending otherwise: a stylized cat is a plain skinned glTF with a custom skeleton, whose joint names are ours to define and whose channel layout is whatever the controller emits.

- Source: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md ; https://github.com/vrm-c/UniVRM/issues/1940
- Date: 2026-09-10
- Confidence: high
- Runs on device: n/a

### Commissioning the rig is a $30–80 gig, not a project, provided the mesh already exists.

Fiverr's rigging category carries character-rigging gigs at $50 and $30 entry prices with typical quotes in the $70–80 range, and dedicated animal-rigging and quadruped-rigging listings exist as their own tag. Those figures are for standard skeleton-plus-weights work on a supplied mesh; expect the upper end and beyond for a rig with facial controls, tail secondary motion and ear articulation, which is the part Meshy's auto-rigger explicitly declines. Given UniRig is free and MIT, the sensible split is auto-rig first and pay a human only for the parts the auto-rigger names as out of scope. Precise pricing for a quadruped rig with tail and ears was not obtainable — Fiverr listing pages resist automated fetching and the surfaced prices are category-level.

- Source: https://www.fiverr.com/categories/video-animation/rigging/3d-rigging ; https://www.fiverr.com/gigs/animal-rigging
- Date: 2026-09-10
- Confidence: low
- Runs on device: n/a

## Numbers

### MANN dog motion capture, total length

- Value: 30 minutes, dog, locomotion and sitting modes; CC BY-NC 4.0; not in the repo, separate `MotionCapture.zip` download
- Source: https://dl.acm.org/doi/10.1145/3197517.3201366 ; https://github.com/sebastianstarke/AI4Animation
- Date: 2026-09-10

### Truebones Zoo, scale

- Value: 70 skeletons, 1,219 motions, 147,178 frames, 3–40 motions per skeleton; cat and lynx present
- Source: https://arxiv.org/pdf/2502.17327
- Date: 2026-09-10

### Truebones Zoo, filtered subset used by MoCapAnything

- Value: 1,038 sequences / 104,715 frames; 978 train / 60 test
- Source: https://arxiv.org/html/2512.10881v2
- Date: 2026-09-10

### Truebones Zoo, price and licence

- Value: $99+ on Gumroad, periodically free with a code; royalty-free including commercial; redistribution of .FBX/.BVH/i-Motion strictly prohibited; credit requested
- Source: https://truebones.gumroad.com/l/skZMC ; https://truebones.gumroad.com/p/reminder-truebones-terms-of-use-and-service
- Date: 2026-09-10

### QuadFM, scale and licence

- Value: 11,784 clips, 20.27 hours, 3.64M frames at 50 Hz, 35,352 text annotations, 12-DoF; promised CC BY 4.0; repository empty as of 2026-09-10
- Source: https://arxiv.org/html/2603.24021 ; https://github.com/GaoLii/QuadFM
- Date: 2026-09-10

### MoCapAnything V2, accuracy

- Value: rotation error ~10° overall (from ~17° in prior work), 6.54° on unseen skeletons; V1 MPJPE 1.06 cm seen / 1.28 cm rare / 1.76 cm unseen, normalised to a 1 m³ cube
- Source: https://arxiv.org/abs/2604.28130 ; https://arxiv.org/html/2512.10881v2
- Date: 2026-09-10

### DeformingThings4D, scale and licence

- Value: 1,972 animation sequences, 122,365 frames, 31 humanoid and animal categories (200 humanoid / 1,772 animal); non-commercial research and education only; animated meshes, not skeletal rig parameters
- Source: https://github.com/rabbityl/DeformingThings4D
- Date: 2026-09-10

### RGBD-Dog, scale and access

- Value: 5 dogs × 5 motion types; BVH joint rotations, 3D markers, LBS weights, neutral meshes, 8–10 HD RGB cameras at 59.97 fps plus 5–6 Kinects at ~6 fps; academic use only, released by signed form to a faculty member
- Source: https://github.com/CAMERA-Bath/RGBD-Dog/blob/master/README.md
- Date: 2026-09-10

### Runtime weight, three.js versus Babylon.js versus Rive

- Value: three.js v0.175.0 ≈ 168.4 kB min+gzip; Babylon.js v8.1.1 ≈ 1.4 MB; `@rive-app/webgl2` v2.40.1 = 413,126 B JS + 2,004,858 B wasm (round 1 measurement); app's existing pdfium.wasm = 4,633,788 B
- Source: https://www.pkgpulse.com/guides/threejs-vs-react-three-fiber-vs-babylonjs-3d-webgl-2026 ; round1-02
- Date: 2026-09-10

### Live2D free-tier parameter ceiling

- Value: 30 motion parameters and 3 blend-shape parameters (Cubism Editor FREE); PRO ¥14,280 first year
- Source: https://www.live2d.com/en/cubism/download/spec/ (via round1-02)
- Date: 2026-08 (carried forward)

### Ready-made rigged stylized cat, price and size

- Value: $4.99 / 1.6 MB (Flat World Cats, Unity, URP-only); $19.99 / 21.9 MB (Cat Kitty Animated, Unity); Sketchfab Store cat 3,408 polys / 3,392 verts / 18 animations, price not shown to unauthenticated fetch; CGTrader stylized cats pack $18.00 unrigged
- Source: the three marketplace listings above
- Date: 2026-09-10

### UniRig requirements and licence

- Value: MIT code and MIT weights; ≥8 GB VRAM CUDA GPU; trained on Rig-XL, 14,000+ rigged assets including quadrupeds; outputs FBX skeleton and merged rigged GLB/FBX
- Source: https://github.com/VAST-AI-Research/UniRig ; https://huggingface.co/VAST-AI/UniRig
- Date: 2026-09-10

### Meshy free tier

- Value: 100 credits per month, CC BY 4.0 on generated assets (irrevocable), humanoid and quadruped auto-rig in under 30 seconds, FBX out, no tail physics or facial rig
- Source: https://help.meshy.ai/en/articles/10137554-what-is-the-ownership-of-the-generated-models ; https://docs.meshy.ai/en/webapp/guides/3d-model/rigging
- Date: 2026-09-10

### Freelance quadruped rigging

- Value: $30–80 typical Fiverr range for character rigging on a supplied mesh; animal-rigging is a distinct category
- Source: https://www.fiverr.com/categories/video-animation/rigging/3d-rigging
- Date: 2026-09-10

## Rejected

**Anything SMAL-based as a shipping component.** BITE, Animal Avatars, 4D-Animal, AniMer/AniMer+, Animal3D and SAM 3D Animal all regress SMAL or a SMAL variant. The Max Planck licence forbids commercial use, forbids redistribution in whole or in part, and forbids training networks for commercial use. MIT code around a non-MIT model is still a non-MIT dependency. Rejected on licence, not on quality.

**Buying a rigged cat from Unity Asset Store, Fab, CGTrader or the Sketchfab Store.** Cheap ($5–20), good enough (3.4k polys, 18 animations), and unshippable in a public repo: all three licences forbid distribution in a form allowing third-party extraction, and unlike Live2D's Core there is no public upstream to fetch from at build time. Unity §3.8(v) additionally forbids using the asset as ML training data, which independently rules out seeding a motion-matching database from those clips.

**DeformingThings4D as motion data.** 1,972 sequences sounds substantial, but it is non-rigidly deforming *meshes* with dense 4D annotations, not skeletal rotations — wrong output type for a rig-parameter controller — and it is non-commercial research and education only.

**Animal3D as motion data.** 3,379 still images. There is no motion in it, and its 3D annotations are SMAL parameters.

**Live2D for a quadruped.** Round 1 rejected it for a blob because a blob has nothing to rig; a cat has the opposite problem. Its parameter API is the cleanest fit of the four for an external stream and the Core is only 207 kB, but 2D mesh deformation cannot rotate a limb behind a torso, the free tier caps at 30 motion parameters, the editor has no Linux build, and neither Core nor Framework may enter a public source-available repo.

**VRM as the asset format.** Humanoid bone hierarchy is mandatory in VRM 1.0; a cat cannot conform. Plain glTF with a custom skeleton.

**Waiting for QuadFM.** CC BY 4.0 and 20.27 hours is the best licence-to-volume ratio in the field, but the repository holds no data as of 2026-09-10, it is dog-only, and 12 DoF has no tail, ears, spine or neck.

**RGBD-Dog for this project.** Real dog mocap with BVH and LBS weights, but access requires a faculty member to sign and submit a data release form, and the terms are academic-use-only. Not obtainable by an individual developer.

**A second native rendering stack (RealityKit) for the first version.** Technically available and the only route past the 60 Hz rAF cap, but it means Swift with no runtime test coverage for every rig change, in a repo whose entire Swift surface today is one audio plugin. Revisit only if the WebView measurably cannot hold the frame rate.

## Gaps

**Whether WebGPU is exposed in WKWebView on iPadOS 26.** Apple's last on-record statement is April 2025 and negative; caniwebview lists it as unknown; WebKit's Safari 26.0 post is silent on WKWebView. One line of JavaScript in the app on a real iPad settles it. Nothing in this plan depends on the answer.

**How many cat clips Truebones Zoo actually contains and at what frame rate.** AnyTop reports 3–40 motions per skeleton and 147,178 frames overall but publishes no per-species breakdown and no fps, so the 147,178 frames cannot be converted to minutes with confidence. Buying the pack answers both in ten minutes.

**MoCapAnything's inference cost.** No published per-video runtime or VRAM figure; "~20× faster than mesh-based pipelines" is a ratio without a baseline. Training was 8×64 GB for 36 hours, which says nothing about inference. This determines whether a few hours of YouTube cat footage is an afternoon or a week.

**Whether MoCapAnything's quality holds on real cat video specifically.** Its demonstrated animals are eagles, jaguars, lions, parrots, crocodiles, dogs, ostriches, turtles, hamsters and anacondas. Jaguar and lion are felids, which is encouraging, but no cat result is shown and its accuracy numbers are on Truebones test clips, not in-the-wild video.

**The per-frame cost of driving dozens of Rive data bindings.** Rive publishes no guidance on setting values every frame, no bone-count cap, and no performance figure for feathering. Unmeasurable without building a probe.

**Triangle and texture budget for a skinned character in WKWebView on an iPad.** Round 1 established the decoded-bitmap failure mode for sprite sheets but nobody has measured a skinned mesh. A 5–10k-triangle cat with one 1024px texture is very likely trivial; "very likely" is not a number.

**"AnimalML".** Named in the brief; no dataset by that name surfaced in any search. Either it is called something else or it does not exist.

**Anything World.** Named in the brief as an auto-rigging option; no primary source was reached within budget. Its status, pricing and output licence are unknown here.

**AniGen's release and licence.** The paper claims image-to-rigged-3D in one shot; the project page redirect returned nothing substantive. Unresolved.

**Whether a fox skeleton retargets convincingly to a stylized cat.** The CC0 route hinges on this and it is an artistic judgement no source can settle. A one-hour Blender test with the Quaternius fox answers it.

**Exact price of a commissioned quadruped rig with tail, ears and facial controls.** Only category-level Fiverr figures were obtainable; the listings resist automated fetching.
