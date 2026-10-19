# 安卓语音第 4 片交接（dev/android-voice-4）

用户要求暂停，停在这里。任务书原文见派发消息；设计在 docs/companion/89-安卓语音.md，不改设计。

## 已做

- `plugins/voice-engine/voice-wire/src/lib.rs`：ConversationEvent（camelCase，非本 kind 的字段 None 不上线）、SpeechCut、SpeechRange、SpeechEvent、SpeechPosition、SpeechEnqueued、SentenceMarks。字段对着 ConversationRun.swift / SpeechOut.swift 和 src/soul/voice/conversation.ts 定。`cargo check -p voice-wire` 过。
- `engine/src/host.rs`：`AudioHost` trait（`control(HostControl)`，不许阻塞、不许回调引擎）、`HostControl`（open{capture}/close/flush/volume/exit 及其 JSON）、`ControlQueue`（JNI 用的那个 host，`next_json` 就是 nativeNextControl）、`Clock` + `MonotonicClock`（libc CLOCK_MONOTONIC）。文件头列了五个 JNI 调用到引擎方法的对应。两个单测。
- `engine/src/playback.rs`：SpeechOut + SpeechClock 的移植，无锁状态机，副作用进 `effects: Vec<Effect>` 由调用方执行。拒收顺序和错误文案照 iOS；cut/refusal token；duck 音量 0.25；25 ms envelope（600 帧，末尾短窗保留）；2400 帧输出电平；drain 的 done/underrun（句子没收尾时干等不算 underrun）；stop 后 queue 清空、handed/base 归零、`read` 回一次 -1 并发 Host(Flush)。七个单测。**未编译过。**
- `engine/src/call.rs`：Engine 编排，整份写完但**未编译过**。Vad/EndOfTurn/Recognise 三个 trait（真模型和假模型都实现它们）、ModelPaths::in_dir（下载目录布局，用 vad::SILERO_FILE、smart_turn::SMART_TURN_FILE、asr::MODEL_FILE/MMPROJ_FILE、kokoro manifest）、NOT_DOWNLOADED 原句、open/open_with/close/audio_event/tick/quiesce、capture 线程（front 锁）→ state 锁、Smart Turn 工作线程、settler 线程等识别结果、Ending 队列把后续事件压在前一轮 speech-end 之后、前一轮还在识别时新一轮的 job 延后提交（deferred）。
- `engine/fixtures/call/{one,then,when,wait,ah}.wav` 和生成脚本 `make_call_fixtures.py`：Kokoro zf_001 在 Linux 合成，16 kHz。Smart Turn（静音 256 ms 后）：one 0.987、then 0.028（判未完，给停顿场景用）、when 0.99、wait 0.984；ah 是「啊」前 160 ms，Silero ≥0.5 四帧（误报场景）。

## 还剩

1. 接线：`engine/Cargo.toml` 加 `libc = "0.2"`（Cargo.lock 里已有 0.2.191）；`engine/src/lib.rs` 加 `pub mod host; pub mod playback; pub mod call; pub mod virtual_device;`；`asr.rs` 加 `pub const MODEL_FILE = "qwen3-asr-0.6b/Qwen3-ASR-0.6B-Q4_K_M.gguf"`、`MMPROJ_FILE = "qwen3-asr-0.6b/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf"`，测试里的 `models()` 改用它们。
2. 编译 call.rs/playback.rs 并修。已知要核的点：
   - call.rs 调了 `Playback::track_closed()`，playback.rs 里没有。要么补（track 关了：handed/base/heard 归零），要么删掉调用。
   - `kokoro_onnx::manifest::Variant::Fp32.file().path`、`manifest::VOICES` 的形状、`kokoro_onnx::engine::Engine::load(&path, threads)` 的签名是凭记忆写的，对着 kokoro-onnx crate 改。
   - `smart_turn::THRESHOLD` 的类型（f32 还是 f64）。
   - `install()` 持 `smart` 锁 join 旧 worker，而 `step()` 持 state 锁再拿 `smart` 锁，旧 worker 在等 state 锁时会死锁。改成先 `take()` 出来、放锁后再 join。
   - `begin_call(None)` 的空参数删掉。
3. `engine/src/virtual_device.rs`：VirtualClock（AtomicI64）、VirtualHost（记录 controls、open 状态、音量、待 flush）、VirtualDevice::step(mic 512 样本)：时钟进 32 ms → 执行 Flush → 打开时播 768 帧（24 kHz）→ `read_playback(wait 0)` 补满（处理 -1：清 track、played_total 归零）→ `playback_position(played_total, now)` → `capture(mic, now)` → `engine.quiesce()`。再加 `feed(samples)`、`idle(ms)`、`played_frames()`。
4. 测试。假模型组（CI 跑）：能量假 VAD、闭包假 Smart Turn、自带线程的假识别器（数有声段出 "one two three…"，支持作废和延迟，记 submit/void 次数），合成音 300 ms 音调 + 100 ms 间隔。场景：F1 一句一轮一个 speech-end；F2 Smart Turn 判未完再接着说，只一个 speech-end 且文本是整句、void > 0；F3 播三句合成句时插话，speech-duck → speech-stop，cut 的 sentence/charOffset/playedMs 等于虚拟设备播放头，spoken(interrupted) 在 speech-stop 之后，见到 Flush 和 SetVolume(0.25)，被切 utterance 后续 enqueue 被丢；F4 128 ms 误报出 duck → resume、无 stop、播放照常 done；F5 缺文件 Err + state failed 带 NOT_DOWNLOADED，且该句和 `plugins/voice/src/tts/kokoro.rs` 里的一致（读源文件断言）；F7 识别器延迟时背靠背两轮，speech-end(1) 在 speech-stop(2) 之前。另加 voice-wire JSON 形状测试。真模型组（`VOICE_MODELS` 缺就跳过，一个 Engine 复用模型）：R1 one.wav（文本含「天气」）；R2 then.wav + 700 ms + when.wav（一个 speech-end，含「然后」和「会议」）；R3 播放音调时喂 wait.wav（cut 对得上，文本含「等一下」）；R4 ah.wav（resume）。
5. 拼 VOICE_MODELS 目录（符号链接，scratchpad 新目录如 `/tmp/claude-1000/-home-xinyuan-Documents-Github-Reading-Partner/e787d23e-11ff-40e6-b812-46785e180875/scratchpad/av4-models/`）：
   - `silero-vad-v6.0/silero_vad.onnx`、`smart-turn-v3.2-gpu.onnx` → `scratchpad/av2-dl/models/` 下同名
   - `qwen3-asr-0.6b/` 两个 gguf → `~/models/qwen3-asr-0.6b/`（只读）
   - `kokoro-v1.1-zh/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3/onnx/model.onnx`、`voices/{zf_001,af_maple}.bin` → `scratchpad/hv-kokoro-engine/models/` 下对应文件
6. 四项检查全过（看退出码）：engine workspace 的 cargo test、`plugins/voice` 的 `cargo test --features kokoro`、`scripts/t.sh`、`bun run typecheck`（没 node_modules 先 `bun install --frozen-lockfile`）。确认 `plugins/voice/src/kokoro_g2p/mod.rs` 没被改。
7. push 后等 android-voice-engine.yml 绿。不合 main。真踩到意外行为才写坑 664/665（docs/pitfall 里 docs/89 指定的那组）。
8. 收尾删掉本文件。

## 关键决定

- 所有判断在 `state` 一把锁下：判停、对播放动手、算 cut 同时发生；`front`（capture 的音频和 Silero）总在 `state` 之前拿。事件在持锁时发出，靠这个保序，所以 `Emit` 不许阻塞或回调。
- 安卓不发 final。speech-end 的文本来自 A-onset 那个 job；空文本照发。
- 播放头 = 最近一次 playback_position 报告 + (now − at) × 24 kHz，封顶在已交出的帧数。flush 后帧计数从零重来（Kotlin 侧的约定）。
- 下载提示用 `plugins/voice/src/tts/kokoro.rs` 的 NOT_DOWNLOADED 原句。

## 和文档不一致之处（最终回报要写）

- state failed 把下载提示放在 `text` 字段；iOS 从不发带 text 的 state failed。
- 「flush playback」控制和 read_playback 返回 -1 两条都实现了，幂等。
- flush 后帧基准归零，是给 Kotlin 的约定，文档没写。
- 照抄的下载提示说「Voice output」，而 docs/89 安卓那节用的是新的 voiceCall 键。
- Open 检查包含 Kokoro 的 voices 文件，虽然引擎加载只要 model.onnx。
