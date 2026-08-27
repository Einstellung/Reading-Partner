# Round 1 / 2 — WebView 里的角色渲染与动画运行时

> 第一轮调研，2026-08-26 跑。原始输出是 JSON，本文件机械转写，措辞未改。每条保留原文、来源 URL、日期和置信度；核实阶段推翻或修正过的条目在 Fact-check 一节，以那一节为准。
>
> 维度原题：Character rendering and animation runtimes for a React/TypeScript WebView on iPadOS (Tauri v2 / WKWebView), plus the single-image-to-riggable-asset pipeline

---

## Headline

For a glowing blue blob (not an anime humanoid), Rive is the only runtime that natively does the glow, the 13 states, and a data-bound energy bar, costs $17 for one month or $108/yr with no royalty and an MIT runtime you can legally commit to a public repo — whereas Live2D is free-of-charge at this revenue level but is legally un-vendorable in a source-available repo and its editor has no Linux build, and every fully-automatic image-to-rig pipeline documented in 2026 still produces a broken model.

## Relevance to this repo

The decisive fact is that the concept art is a glowing blue blob, not an anime portrait, and that inverts the usual Live2D-versus-everything comparison. Live2D's entire value is rigging occluded anime features — bangs over eyes, a closed mouth that must open, a neck seam — which is exactly the part that both documented 2026 auto-rig attempts failed at, and exactly the part a radially-symmetric blob does not have; paying for that machinery buys a Windows/macOS-only editor (your dev box is Linux, so rigging moves to the Mac mini) and two artifacts that legally cannot live in a public PolyForm-NC repo, forcing a second `bun run wasm`-style fetch script for the Core plus the Framework source. Rive costs $17 for one month or $108/yr, its runtime is MIT so it is a normal dependency, its Vector Feathering *is* the glow you drew, its state machines *are* the 8 emotions and 5 idles, and data binding drives the energy bar from your existing token-budget module without any imperative glue. The concrete price is that feathering needs `@rive-app/webgl2`, whose 2.0 MB wasm lands on top of the 4.63 MB pdfium.wasm the app already carries — a 43% increase in wasm weight, not a category change — and your `tauri.conf.json` CSP already grants `wasm-unsafe-eval` with `default-src 'self'`, so you self-host `rive.wasm` in `public/` exactly as you do pdfium and set `RuntimeLoader.setWasmUrl` to point at it, since the default unpkg URL would be blocked by both the CSP and your `require-corp` COEP header. Sprite sheets should be ruled out on the decoded-memory number, not the disk number: 2.6 MB of WebP becomes 327 MB of live RGBA at 512px, which is how you get the WKWebView content process killed on an iPad mid-read. Budget for 60 fps and no more — rAF is capped at 60 Hz in WKWebView while your Tailwind CSS transitions run at 120 Hz, so the character will always be the lower-refresh element on screen and it is not worth fighting. For the asset pipeline, a non-artist genuinely can ship a coherent 13-state blob in 2026, but the winning path is not auto-rigging: use Nano Banana 2 with reference-image locking at $0.067/image to lock the look across all 13 states for well under $20, then redraw that as vector shapes directly in Rive's browser editor (which runs on Linux) and animate with transforms, feathering and interpolated states — days of work, not weeks. That answer would be different if the character were humanoid; then the honest estimate is weeks and a commissioned rig.

## Findings

### Live2D charges Reading-Partner nothing: no Publication License Agreement is required at all for individuals or entities with annual sales under ¥10,000,000.


Live2D's own help page states no contract is required for "Content published by Small-Scale Enterprises and General Users with annual sales of less than 10 million" (JPY). The paid tiers only start above that: Middle-Scale (<¥100M sales) pays ¥100,000 / $628.90 one-time for non-console content, Large-Scale (>¥100M) pays ¥600,000 / $3,773.40; an alternative per-unit plan is ¥40 / $0.25 per unit produced. Those discounted rates are conditional on displaying the Live2D logo in the content and letting Live2D feature it on their Showcase page. The one trap is "Expandable Applications" — works that "use and generate any indefinite numbers of models" (i.e. the user can import their own models) — which require review and a special agreement even for exempt individuals. Reading-Partner ships one fixed character, so it is a General Application and stays exempt.

- Source: https://help.live2d.com/en/sdk/sdk_001/
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Neither the Live2D Cubism Core nor the Cubism Framework may be committed to a public source-available repository — both licenses forbid it, despite one being branded "Open".


The Proprietary Software License Agreement §6.2 says the customer "may not distribute or disclose all or part of this Software", and §5.3.2 forbids altering or distributing it "in such a way that the excluded license is applied" — i.e. you cannot place it under PolyForm-NC or any OSS license. The Cubism Framework's "Live2D Open Software License Agreement" is not an OSI license either: §2.2 permits distribution only when incorporated into a Derivative Work shipped to end users, to other equivalent licensees, or as snippets of "about thirty lines". So both the 207 KB Core and the TypeScript Framework would have to be gitignored and fetched at build time. Reading-Partner already has exactly this pattern — `scripts/copy-pdfium-wasm.sh` behind `bun run wasm` — so the workaround is a known shape, but it is now two artifacts instead of one binary, and the Framework is source you would normally want in-tree.

- Source: https://live2d.github.io/assets/live2d-proprietary-software-license-agreement_en.html
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Live2D Cubism Editor has no Linux build — it ships for Windows 10/11 and macOS 13–15 + 26 only — so all rigging would have to happen on the Mac mini, not the dev machine.


The official system requirements page for Cubism 5.3.00 beta1 onward lists only Windows (64-bit, OpenGL 3.3+, 4 GB RAM min) and macOS (Ventura/Sonoma/Sequoia/Tahoe, Apple Silicon or Intel, 8 GB RAM). No Linux entry exists. The FREE editor tier is genuinely usable for a simple character — 100 ArtMesh, 30 motion parameters, 3 blend-shape parameters, 50 deformers, 30 parts, one 2048px texture — and FREE may be used commercially by anyone under ¥10M annual sales. PRO costs ¥2,080/month or ¥14,280 for year 1 annually (¥10,680 from year 3), i.e. roughly $90 the first year for an indie.

- Source: https://www.live2d.com/en/cubism/download/spec/
- Date: 2026-08
- Confidence: high

### Rive's runtime is MIT-licensed and carries no royalty or per-app fee; exported .riv files keep working forever even after the subscription lapses.


rive-wasm ships under the MIT License, so unlike Live2D it can simply be a dependency in the public repo. Rive's own announcement is explicit: "No runtime fee. Your exports keep working forever" and "Rive files don't phone home or depend on an active subscription." The gate is on export, not on shipping: the free tier is editor-only, and exporting a .riv for production requires at least the Cadet plan at $9/seat/month billed annually or $17/month billed monthly, capped at 3 seats. In practice that means a single $17 month is enough to produce a character you can ship indefinitely; $108/yr keeps you able to iterate.

- Source: https://rive.app/blog/rive-s-new-9-mo-plan
- Date: 2025-10-20
- Confidence: high
- Runs on device: ios-yes

### Rive's Vector Feathering is a purpose-built glow/blur primitive — but it only works in the Rive Renderer, so a glowing character forces @rive-app/webgl2 and its 2.0 MB wasm rather than the Canvas2D runtime.


Feathering softens vector path edges to produce glows and shadows without a Gaussian blur pass, tunable via Amount/Offset/Inner, and was released to the editor on 2025-02-11 (Mac and Windows desktop, and the web editor with Chrome + WebGL draft extensions). Rive's runtime docs state plainly that @rive-app/canvas "does not yet support vector feathering" while @rive-app/webgl2 does. Measured 2026-08-26 from unpkg at v2.40.1: webgl2 is rive.js 413,126 B raw / 92,863 B gz plus rive.wasm 2,004,858 B raw; canvas is 410,792 B / 92,116 B gz plus 1,808,114 B wasm (746,770 B gzipped); canvas-lite drops to a 767,316 B wasm but sheds the text, layout, audio and scripting engines. Rive gives no numeric performance figures for feathering, only the claim that it is "hyper-performant on lower-end hardware".

- Source: https://rive.app/docs/runtimes/web/canvas-vs-webgl
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### Rive's 2026 AI features generate scripts, not artwork or animation — there is still no text-or-image-to-animation generator in Rive.


Rive shipped Scripting with an AI Coding Agent on 2026-01-13; the agent turns plain-language descriptions into interaction scripts and Rive frames its output as "a first draft", with a prompt-test-refine loop and advice to send small specific prompts. Artwork and animation still come from a human in the editor. A community feature request for "AI-powered Animation & State Machine Generator from SVG/Image Inputs" was still an open request as of mid-2026. The paid tiers bundle agent credits ($20/seat/month on Voyager at $32/seat, $40/seat on Enterprise at $120/seat), which is the only place AI cost appears.

- Source: https://rive.app/blog/scripting-with-the-ai-coding-agent
- Date: 2026-01-13
- Confidence: high

### requestAnimationFrame is hard-capped at 60 Hz inside WKWebView by Apple's design, while CSS animations run at 120 Hz on ProMotion iPads — so any canvas/WebGL character will visibly run at half the refresh rate of the CSS chrome around it.


WebKit bug 173434 and Apple's developer forums confirm rAF callbacks are deliberately throttled to 60 Hz in WKWebView for power reasons, and that the Safari 18.3 flags unlocking higher framerates do not apply to WKWebView. CSS-composited animations and the Web Animations API on composited properties do reach 120 Hz. Tauri v2's iOS target is WKWebView, so this applies directly. 60 fps is ample for a character, but it means a CSS/SVG character would actually be the *smoother* one on an iPad Pro, and it means you should not chase 120 fps in a canvas runtime.

- Source: https://bugs.webkit.org/show_bug.cgi?id=173434
- Date: 2026-08
- Confidence: medium
- Runs on device: ios-yes

### Sprite sheets die on decoded texture memory, not on file size: 13 states × 24 frames at 512px is only 2.6 MB on disk but 327 MB of decoded RGBA bitmaps.


Measured locally on 2026-08-26 by generating a synthetic glowing-blob sprite (soft radial glow, body, eyes) and encoding it: at 512px, WebP q80 is 8,314 B/frame → 2.6 MB for 13×24 frames; at 1024px, 17,935 B/frame → 5.6 MB; lossless WebP at 1024px balloons to 27.0 MB. But one 24-frame 512px atlas is 3072×2048 = 25.2 MB of decoded RGBA, and 13 of them is 327.2 MB; at 1024px it is 100.7 MB per atlas and 1.31 GB for all 13. Caveat: the test blob is smooth-gradient and therefore best-case for the codec — a textured AI illustration would be roughly 2–4× larger on disk, though the decoded-memory figures are exact and format-independent. You would have to stream and evict atlases, which is exactly the complexity a runtime like Rive exists to avoid.

- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- Date: 2026-08-26
- Confidence: high
- Runs on device: ios-yes

### Two independent 2026 attempts at fully automatic single-image-to-Live2D produced models that were unusable, for the same structural reason.


A non-engineer builder documented the full attempt on 2026-07-19: ComfyUI background removal plus Cubism Editor, segmenting 29 parts (face, front hair, back hair, eyes, mouth, neck, torso), auto-mapping textures onto a generic rig preloaded with head movement, blinking, lip-sync, sway and breathing, and exporting .moc3/.model3.json/textures. Across 23 test runs, a real anime illustration broke it: hair shapes didn't fit, eye and mouth positions overlapped or vanished, and gaps opened at the face-neck-torso joins. His diagnosis: "A single illustration does not contain the information needed to make it move" — what's behind the bangs, inside a closed mouth, or below the neck line is a human decision, not an inference. Verdict: automate the tedious 80%, leave 20% to a human. Separately, VTuber2D.AI demoed one-image cutout + layering + auto-bone-binding on 2026-05-03 with the author calling it "非常初期" and showing failures uncut; it is still an email waitlist.

- Source: https://note.com/dn0288/n/nf89c79d14d27
- Date: 2026-07-19
- Confidence: high

### Character consistency across generated images is a solved-enough problem and costs cents: Gemini's Nano Banana Pro accepts 5 reference images for character locking and Nano Banana 2 accepts 4, at $0.067 per 1K image.


Google's own docs list gemini-3-pro-image (Nano Banana Pro, character consistency up to 5 reference images, 1K/2K/4K out), gemini-3.1-flash-image (Nano Banana 2, up to 4 reference images, 512px/1K/2K/4K), and gemini-3.1-flash-lite-image (character consistency not supported). Pricing: flash-image is $0.045 per 0.5K, $0.067 per 1K, $0.101 per 2K, $0.151 per 4K; flash-lite is $0.0336 per 1K; pro-image is $0.24 per 4K. Independent testing reported by a March 2026 guide had Nano Banana Pro hold identity across all 5 scenes of a fixed-character test where Midjourney v6 drifted into a different person by scene 3 and GPT Image degraded by scene 4–5; the same source notes character locking is session-dependent, so the reference must be re-uploaded each session. Generating 13 states with 20 candidates each at 1K costs about $17.

- Source: https://ai.google.dev/gemini-api/docs/pricing
- Date: 2026-08
- Confidence: high
- Runs on device: server-only

### Every open image-to-3D model that matters in 2026 outputs a static mesh with no skeleton and no blendshapes, and none of them run without a large NVIDIA GPU.


TRELLIS.2-4B (Microsoft, MIT license, released 2025-12-16, arXiv 2512.14692) is a 4B image-to-3D model producing up to 1536³ PBR-textured meshes — and requires ≥24 GB VRAM, CUDA 12.4, tested only on Linux/A100/H100, with no rig or morph targets in the output. The original TRELLIS needed ≥16 GB. Hunyuan3D 2.1 (June 2025) is the last open-weights Hunyuan; 2.5, 3.0 and 3.1 are hosted-only. None can run on Apple Silicon, let alone on-device. For an app whose character needs 8 facial emotion states, a rig-less mesh is the wrong end of the problem: the expensive part of a 3D character is the blendshapes, and that is precisely what these do not produce.

- Source: https://huggingface.co/microsoft/TRELLIS.2-4B
- Date: 2025-12-16
- Confidence: high
- Runs on device: server-only

### Lottie/dotLottie closed the interactivity gap in 2026 with native state machines, but still cannot deform meshes, drive bones, or blend continuously from a numeric input — and has no glow primitive.


dotLottie v2.4.0 put state machines into the .lottie file format itself with official SDKs on Web, iOS and Android, so "idle → surprised → talking" transitions no longer need JS glue, and .lottie files are 30–50% smaller than the equivalent .json. Measured 2026-08-26: @lottiefiles/dotlottie-web v0.79.2 is 155,844 B raw / 30,175 B gz of JS plus a 1,222,210 B wasm; plain lottie-web v5.13.0 is 305,885 B / 76,789 B gz with no wasm. What it fundamentally cannot do is what an After Effects timeline cannot do: there are no bones, no weighted mesh deformation, no IK, and no blend states that interpolate a pose from a continuous scalar. "Eyes track the reading cursor" and "energy bar drives how brightly the body pulses" are Rive blend-state/data-binding features with no Lottie equivalent.

- Source: https://lottiefiles.com/blog/working-with-lottie-animations/dotlottie-v2-4-0-state-machine-support
- Date: 2026-08
- Confidence: medium
- Runs on device: ios-yes

### Spine's cheap tier is useless for a squashy blob: meshes, free-form deformation, weights and IK are all Professional-only at $379.


Spine Essential is $69 (list $99) and explicitly excludes meshes, deformation, weights and IK constraints — it is bone-and-cutout animation only. Professional is $379 (list $449). Enterprise, mandatory above $500,000 USD annual revenue from any source including investment, is $2,499 base plus $379 per user annually. An editor license is required to integrate the runtimes at all; after a license lapses you may keep distributing existing products but may not integrate the runtimes into new ones. Since a glowing blob is defined by squash-and-stretch, the real Spine price is $379 up front, versus $17–108 for Rive.

- Source: https://esotericsoftware.com/spine-purchase
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### The two biggest Chinese AI-companion apps abandoned rigged 2D characters: MiniMax's 星野 moved to AI video generation for character motion and ByteDance's 猫箱 uses AI-drawn dynamic stand art.


星野 launched its "2.0 Live" era on MiniMax's Hailuo video model, generating smiling/shy/hand-holding motion per interaction rather than driving a rig; 猫箱's AI drawing workshop generates character images from text with outfit and expression swaps. Both are shipped products with Kimi-scale traffic. The read for a reading companion is negative rather than positive: video generation gives you infinite expression variety at the price of per-turn latency and per-turn API cost, and cannot idle, breathe or react to a scroll — the exact properties a persistent on-screen companion needs. It confirms the rigged-character route is a deliberate choice, not the default.

- Source: https://news.sina.cn/sx/2024-12-25/detail-ineasmtm0652144.d.html
- Date: 2024-12-25
- Confidence: medium
- Runs on device: server-only

### Unity as a Library is disqualified by memory alone: it retains 110 MB on iOS even while unloaded, and cannot be restarted once quit in the same session.


Unity's own documentation puts the unloaded-state overhead at 110 MB on iOS, with a range of 80–180 MB depending on graphics resolution, held so Unity can resume instantly. And on iOS, once the runtime fully quits via Application.Quit, it cannot be reloaded in the same app session — so a companion you dismiss and re-summon is either permanently costing 110 MB or permanently gone. Against a WKWebView app that today carries a 4.63 MB pdfium.wasm as its heaviest asset, this is two orders of magnitude of complexity for a mascot.

- Source: https://docs.unity3d.com/6000.0/Documentation/Manual/UnityasaLibrary.html
- Date: 2026-08
- Confidence: high
- Runs on device: ios-yes

### The Live2D Cubism Core for Web is remarkably small — 207,155 bytes raw, 61,392 gzipped — an order of magnitude under Rive's wasm.


Measured 2026-08-26 by fetching https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js. It is compiled JavaScript, not wasm, so it also sidesteps the CSP `wasm-unsafe-eval` and COEP questions entirely. Live2D officially lists Safari on iOS among supported browsers for the Web SDK. The web-specific caveats are mundane: cache the WebGL context and pass framebuffer/viewport to the renderer rather than calling getters in a loop, dereference objects manually since GC won't, and set UNPACK_PREMULTIPLY_ALPHA_WEBGL to true because Live2D draws premultiplied. Community wrapper support has fragmented — guansss/pixi-live2d-display never shipped Cubism 5 and the maintained path is the omniwaifu/pixi-live2d5 fork.

- Source: https://docs.live2d.com/en/cubism-sdk-manual/platform/
- Date: 2026-08-26
- Confidence: high
- Runs on device: ios-yes

## Numbers

### Live2D Publication License fee for an individual / entity under ¥10M annual sales

- Value: ¥0 — no agreement required at all
- Source: https://help.live2d.com/en/sdk/sdk_001/

### Live2D Publication License, Middle-Scale (<¥100M sales), non-console one-time

- Value: ¥100,000 / $628.90 (or ¥40 / $0.25 per unit produced)
- Source: https://www.live2d.com/en/sdk/license/purchase_plan02/

### Live2D Publication License, Large-Scale (>¥100M sales), non-console one-time

- Value: ¥600,000 / $3,773.40
- Source: https://www.live2d.com/en/sdk/license/purchase_plan02/

### Cubism Editor PRO, indie, first year annual

- Value: ¥14,280 / $89.82 (¥10,680 from year 3; ¥2,080/mo monthly)
- Source: https://store.live2d.com/en/

### Cubism Editor FREE tier limits

- Value: 100 ArtMesh, 30 motion params, 3 blend-shape params, 50 deformers, 30 parts, 1 texture ≤2048px
- Source: https://www.live2d.com/en/cubism/comparison/

### Live2D Cubism Core for Web, measured 2026-08-26

- Value: 207,155 B raw / 61,392 B gzipped (JS, no wasm)
- Source: https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js

### Rive Cadet plan (minimum tier that can export a shippable .riv)

- Value: $9/seat/mo billed annually ($108/yr), or $17/mo billed monthly; 3 seats max
- Source: https://rive.app/blog/rive-s-new-9-mo-plan

### Rive runtime royalty / per-app fee

- Value: $0 — exports keep working forever after cancellation
- Source: https://rive.app/blog/rive-s-new-9-mo-plan

### @rive-app/webgl2 v2.40.1 (required for glow/feathering), measured 2026-08-26

- Value: rive.js 413,126 B raw / 92,863 B gz + rive.wasm 2,004,858 B raw
- Source: https://www.npmjs.com/package/@rive-app/webgl2

### @rive-app/canvas v2.40.1 (no feathering), measured 2026-08-26

- Value: rive.js 410,792 B / 92,116 B gz + rive.wasm 1,808,114 B raw / 746,770 B gz
- Source: https://www.npmjs.com/package/@rive-app/canvas

### @rive-app/canvas-lite wasm (drops text, layout, audio, scripting)

- Value: 767,316 B raw
- Source: https://rive.app/docs/runtimes/web/canvas-vs-webgl

### @lottiefiles/dotlottie-web v0.79.2, measured 2026-08-26

- Value: 155,844 B raw / 30,175 B gz JS + 1,222,210 B wasm
- Source: https://github.com/lottiefiles/dotlottie-web

### lottie-web v5.13.0

- Value: 305,885 B raw / 76,789 B gz, no wasm
- Source: https://www.npmjs.com/package/lottie-web

### Reading-Partner's existing heaviest asset, for scale

- Value: public/pdfium/pdfium.wasm = 4,633,788 B
- Source: https://github.com/Einstellung/Reading-Partner

### Sprite sheet on disk: 13 states × 24 frames, 512px, WebP q80 (measured, smooth-gradient blob = best case)

- Value: 8,314 B/frame → 2.6 MB total (1024px: 17,935 B/frame → 5.6 MB)
- Source: https://developers.google.com/speed/webp/docs/cwebp

### Sprite sheet decoded RGBA memory: 13 states × 24 frames

- Value: 512px → 327.2 MB; 1024px → 1,308.6 MB (25.2 MB and 100.7 MB per single atlas)
- Source: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices

### Spine Professional (Essential excludes meshes, deformation, weights, IK)

- Value: $379 (Essential $69; Enterprise $2,499 + $379/user/yr above $500K revenue)
- Source: https://esotericsoftware.com/spine-purchase

### Unity as a Library, iOS memory retained while unloaded

- Value: 110 MB typical (80–180 MB range)
- Source: https://docs.unity3d.com/6000.0/Documentation/Manual/UnityasaLibrary.html

### three.js core v0.185.1 (before three-vrm, loaders, or the model)

- Value: 709 KB raw / 178 KB gzipped
- Source: https://bundlephobia.com/package/three

### TRELLIS.2-4B image-to-3D requirements

- Value: ≥24 GB VRAM, CUDA 12.4, Linux only; MIT license; static mesh, no rig or blendshapes
- Source: https://huggingface.co/microsoft/TRELLIS.2-4B

### Nano Banana 2 (gemini-3.1-flash-image) per-image output cost

- Value: $0.045 / 0.5K, $0.067 / 1K, $0.101 / 2K, $0.151 / 4K; up to 4 character reference images
- Source: https://ai.google.dev/gemini-api/docs/pricing

### Nano Banana Pro (gemini-3-pro-image) character reference images and 4K price

- Value: up to 5 reference images; $0.24 per 4K image
- Source: https://ai.google.dev/gemini-api/docs/image-generation

### requestAnimationFrame ceiling inside WKWebView on a 120 Hz iPad

- Value: 60 Hz, by Apple's design; CSS animations run at 120 Hz
- Source: https://bugs.webkit.org/show_bug.cgi?id=173434

## Fact-check

### N2 Middle-Scale one-time = ¥100,000 / $628.90 (or ¥40/$0.25 per unit)

- Verdict: **corrected**

Correction: Current site figure is $629.00 USD (not $628.90), yen figure ¥100,000 confirmed exact; per-unit ¥40/$0.25 confirmed exact. This is a trivial 10-cent USD-conversion drift (exchange-rate timestamp), not a material error.

Evidence: https://www.live2d.com/en/sdk/license/purchase_plan02/ shows '$629.00USD [¥100,000]' and '$0.25USD [¥40]' per unit at time of this check (2026-08-26).

### N3 Large-Scale one-time = ¥600,000 / $3,773.40

- Verdict: **corrected**

Correction: Current site figure is $3,774.00 USD (not $3,773.40); yen ¥600,000 confirmed exact. Again a trivial ~60-cent USD-conversion drift, immaterial.

Evidence: https://www.live2d.com/en/sdk/license/purchase_plan02/ shows '$3,774.00USD [¥600,000]' at time of this check (2026-08-26).

### N12 @lottiefiles/dotlottie-web v0.79.2: 155,844 B / 30,175 B gz JS + 1,222,210 B wasm

- Verdict: **corrected**

Correction: wasm figure (1,222,210 B) confirmed exactly. JS figure differs slightly: independently downloaded dist/index.js = 156,045 B raw (vs report's 155,844 B, ~0.13% larger) and gzip = 30,150 B (vs report's 30,175 B) — both within ~200 bytes, consistent with minor build/compression-tool variance rather than a wrong package or version. Not materially different.

Evidence: https://unpkg.com/@lottiefiles/dotlottie-web@0.79.2/dist/index.js and .../dotlottie-player.wasm, downloaded and measured directly 2026-08-26.

## Dead ends

- Unity or Unreal as an embedded view — Unity retains 110 MB on iOS even when unloaded and cannot be restarted after Application.Quit in the same session, for a mascot in a reading app.
- VRM / VRoid Studio + three.js — VRoid produces anime humanoids, which is not the character that was designed; you would be redesigning the concept to fit the tool, and three.js core alone is 709 KB before any loader or model.
- Image-to-3D (TRELLIS.2, Hunyuan3D, Tripo, Meshy) as an asset source — all output static meshes with no skeleton and no blendshapes, so the 8 facial emotion states, the actual expensive part, are exactly what you do not get.
- Running any image-to-3D model locally — TRELLIS.2-4B needs ≥24 GB VRAM and CUDA on Linux; there is no Apple Silicon or on-device path, so this is a server-GPU-only step regardless.
- Fully automatic single-image-to-Live2D (VTuber2D.AI, ComfyUI+Cubism scripting, CartoonAlive) — two independent 2026 attempts produced misaligned eyes/mouths and torn neck seams; a flat illustration does not contain what is behind the bangs.
- Spine Essential at $69 — it excludes meshes, free-form deformation, weights and IK, so a squash-and-stretch blob needs Professional at $379, five times Rive's annual price.
- Lottie/dotLottie for a *reactive* companion — state machines landed in v2.4.0, but there are still no bones, no mesh deformation, and no blend state driven by a continuous scalar, so gaze-follow and an energy-driven pulse have no expression in the format.
- @rive-app/canvas (the smaller, Canvas2D runtime) — it does not support vector feathering, which is the one Rive feature that draws your glow; the 1.2 MB saving costs you the character's defining visual.
- @rive-app/canvas-lite — its 767 KB wasm looks attractive until you note it drops the text, layout, audio and scripting engines.
- Committing the Live2D Core or Framework to the public repo — the Proprietary agreement §6.2/§5.3.2 and the misleadingly-named Open Software License §2.2 both forbid public redistribution and forbid applying an OSS license to them.
- Rive's free tier as a shipping path — the editor is free forever but production export requires Cadet; conversely, do not buy an ongoing subscription reflexively, since one $17 month yields a .riv that works forever with no runtime fee.
- Per-turn AI video generation for the character, the route 星野 took — it cannot idle, breathe, or react to a scroll, and every reaction costs latency and money.

## Open questions

- The exact 1K/2K price for gemini-3-pro-image (Nano Banana Pro) — the pricing table rendered malformed on fetch; only the $0.24-per-4K figure and the $2.00/M input rate came through cleanly.
- Measured fps, CPU and battery draw for a Rive webgl2 character inside a Tauri WKWebView on a real iPad — no published benchmark exists, and this is the one number that would settle the runtime choice. It needs a spike on the Mac mini build loop, not more searching.
- WKWebView's actual jetsam memory ceiling on current iPads — the web search budget ran out before this could be sourced, so the 327 MB decoded-atlas figure is presented as a risk without the threshold it crosses.
- Whether CartoonAlive (arXiv 2507.17327) ever released code or weights — the paper is CC BY 4.0 and reports sub-30-second generation, but no release could be confirmed.
- VTuber2D.AI's current status, output format (PSD layers vs. a complete .moc3) and pricing — the site returns 403 to automated fetches and appears to still be an email waitlist as of the May 2026 demo.
- Whether the Live2D non-profit plans impose any notification duty on a free App Store app that is already exempt by the ¥10M threshold — the plan pages 404 and the FAQ addresses revenue, not free distribution.
- How much larger the sprite-sheet numbers get for the actual concept art — the measurement used a synthetic smooth-gradient blob; a textured illustration is estimated at 2–4× on disk but was not measured against the real sheet.

## Unverifiable

- N6 Cubism Core for Web = 207,155 B raw / 61,392 B gzipped
