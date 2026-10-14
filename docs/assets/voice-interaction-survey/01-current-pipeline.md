# 现有语音通话链路（2026-10-14 读代码所得）

范围：长按 Lumen 进的 info 语音通话（`src/ui/components/lumen/use-voice-call.ts:108` → `src/info/briefer/voice-call-live.ts:94`）。只在 iOS 上有，别的平台插件拒绝启动（`plugins/voice/README.md` 开头）。全部实测都是 iPhone 16 / iOS 26.5–26.6、手持、正常说话距离；iPad 上一条都没量过（docs/info/33:386）。

## 1. 逐段

| 段 | 做法 | 代码 |
|---|---|---|
| 采集 | `.playAndRecord` + `.voiceChat` + `[.defaultToSpeaker, .allowBluetooth]`；`setVoiceProcessingEnabled(true)`（VPIO：AEC + AGC）；tap 请求 4096 帧，实际约 4800 帧，到达间隔 113–208 ms（中位 92 ms） | `plugins/voice/ios/Sources/AudioFront.swift:859-861`、`:399`、`:421`；坑 161 |
| VAD/端点 | 每个 tap 缓冲算一次 RMS dBFS，喂一台 dB 阈值 + 计时器的状态机。默认 `startDb -35`、`startFrames 1`、`confirmMs 300`、`resumeMs 300`、`hangoverMs 1250`、`resumeGuardMs 300`、`immunityMs 2000`。阈值固定，不随环境底噪调整，不看频谱，不认人。Apple `SpeechDetector` 实测 71.7 s 里 0 个事件，所以没用（docs/info/33:202）。tap 停了以后有 250 ms 一次的定时器补静音帧 | `src/soul/voice/turn-detect.ts:113-121`、`:211-280`；Swift 移植 `VoiceTurn.swift:133-139`；`ConversationRun.swift:461-484`；`SpeechOut.swift:594-598`、`:621-659` |
| ASR | 设备端 `SpeechAnalyzer` + `SpeechTranscriber`，`[.volatileResults, .fastResults]`，48 kHz 转 16 kHz，**整通电话一直流式喂**。轮次结束（hangover 到点）时调 `finalize(through: nil)`（宽限 1500 ms），把落在本轮时间窗内（±300 ms）的定稿加尾部 volatile 拼起来作为 `speech-end` 文本。locale 只能设 zh-CN / en-US 之一 | `Recogniser.swift:95-99`；`ConversationRun.swift:130`、`:138`、`:567-590`、`:610-627`、`:646-670` |
| 送 LLM | `speech-end` → 状态机 `ask` → `info-voice.ts answer()`：先 `quiet()` 等这条对话上别的回合（文字聊天、答铃、上一个被打断的回合）全部落盘（坑 529），再 `prepareInfoTurn` 现场装配（读设置、装当天简报锚点、整条线程历史、全套 companion 工具 + lab 工具），再在 durable 运行时（SQLite）起回合。模型是 talk 档 = 设置里的默认对话模型，思考档跟文字聊天走 `chatThinking`（默认 low），**没有语音专用的快模型或短提示词**。流式：durable 视图每次更新整段重投影成行，`voiceFeed` 取文本增量 | `src/reading/turn/info-voice.ts:229-244`、`:278-330`；`src/info/briefer/info-durable.ts:206-241`；`src/ai/model-tier.ts:4-7`；`src/platform/app/settings.ts:203` |
| 切句 | 先规范化后切。硬边界 `。！？；：` 和换行；软边界 `，、` 要攒够 12 字，本轮第一句 1 字即可。但流式冻结点要求「前一个字符是硬边界、后一个字符是字母/数字/汉字」（`lastFreezePoint`），所以**第一句至少要等模型写出第一个句号类标点再多吐一个字**，软边界的「第一句提前发」只在已冻结的那段里生效。英文 `.` `?` `!` `,` 都不是边界：英文回复只在换行或整轮结束时才出句 | `src/soul/voice/speech/split.ts:30-39`、`:96-108`、`:180-226` |
| TTS | 小米 `mimo-v2.5-tts`，音色冰糖，SSE 流式 24 kHz PCM，一句一个请求。Relay：`prefetch_ms 6000`、`concurrency 2`、句间补 160 ms、句首尾按 -45 dBFS 裁静音。**一句合成完、裁完才整句交给播放器**（句内流式只用在裁剪上）。连接池空闲 120 s、建连超时 2.5 s、单读超时 10 s、最多 3 次。开场句预合成 `OpeningCache` 写好了但生产路径没接（只在 `tts/mod.rs` 导出，`SpeechSession` 不用） | `plugins/voice/src/tts/relay.rs:52-60`、`:336-350`；`plugins/voice/README.md:186`；`tts/mimo.rs:22-41`；`tts/trim.rs:76`；`src/session.rs:177-203` |
| 播放 | `AVAudioPlayerNode` 挂在同一台 VPIO engine 上，按句 `scheduleBuffer` 首尾相接；队列跑空就 `stop()`（下一句来时重新 begin） | `SpeechOut.swift`；README「What the playback path promises」 |
| 打断 | 越过 -35 dBFS 一个缓冲 → duck（原生侧直接把音量降到 0.25）；持续 300 ms → stop（原生侧当场停播并读截断位置）；300 ms 内静下来 → resume。每轮放音开始后 2000 ms 免疫期，期间响帧全不算。webview 收到 `speech-stop` 后 abort 模型回合、`speak_stop` 停 Rust 合成、按句截断落记录 | `SpeechOut.swift:187`、`:621-659`、`:822`、`:852`；`src/soul/voice/voice-session.ts:229-243`、`:315-345` |
| 回声 | 只靠 VPIO。08-29 摆位：手机自播 50 个 bigram 识别出 0 个；09-05 摆位：放音开始后 591–1578 ms 有 4 帧过 -35（最高 -28.7），识别器写下了手机自己说的「说好你」。免疫期就是为这 1.6 s 收敛窗设的。另一层保护是 ASR 结果按时间窗归属，落在任何用户轮次窗外的结果直接丢 | docs/info/33:167、:206-208、:262-272；`ConversationRun.swift:646-670` |

## 2. 每段延迟

实测（有出处）：

- tap 缓冲间隔 113–208 ms，09-05 中位 92 ms（docs/info/33:177、:206）。这是 duck 能有多快的下限。
- `finalize(through: nil)` 调用 50 ms，不丢字；不强制的话定稿要 2316–2847 ms（docs/info/33:204、:236）。
- 小米 TTS，iPhone 16 直连 12 句：请求到首帧 min 375 / p50 628 / max 1031 ms；**请求到整句收全 min 860 / p50 1853 / max 2855 ms**；bench 起点到第一个可闻的字 1619 ms（docs/info/33:282，`docs/assets/voice-device-run/speech-result-2026-09-05-run2.json`）。桌面直连端到端首帧 p50 687 ms，含句首静音的首字 804–853 ms（docs/info/33:290、:296）。HTTP/2 复用连接首帧 355–515 ms，新建连接 536–754 ms（docs/info/33:141）。
- 播放侧：输出延迟 8.5 ms + 一个约 23 ms 的 IO buffer（docs/info/33:244）。
- 冷启动引擎：press 到第一个缓冲 1082 ms，复用 304 ms（docs/info/33:238）。通话首次开麦付冷启动那一档。
- 模型：文字聊天那条路「本机实测一轮模型调用地板约 5 秒，低档思考第一轮 600-1300 字，生成每秒 35-40 token」（docs/soul/72:99）。语音和它走同一条装配和同一个模型，语音专属的首 token 数没有。

没有的数：语音通话从「用户说完」到「第一个字出声」的端到端从未量过。设备上 `turn-log.jsonl` 会记每轮模型的 `first-byte` 毫秒数（`src/legion/durable/turn-log.ts:7-10`、`:90`），原生侧有 `RP-CALL finalize %.0fms` 和 `turn %d ended ... silent %.0fms` 日志（`ConversationRun.swift:626`、`:674`），但两边时钟没对上，仓库里也没有导出过的数据。

结构性下限（推算，不是实测）。用户最后一个字之后：

| 环节 | 下限 | 典型 |
|---|---|---|
| hangover 静音判定 | 1250 ms | 1250 + 0–200（等下一个缓冲到） |
| 强制定稿 | 50 ms | 50 |
| 事件到 webview、quiet()、prepareInfoTurn、durable 起回合 | 未量 | 未量（有 SQLite 和线程文件读写，首轮还要加载工具 chunk） |
| 模型首 token 加写到第一个「。」再多一个字 | 未量 | 参考文字聊天约 5 s 地板（含 low 档思考），有工具调用时再加一整轮 |
| 第一句整句合成 | 860 ms | 约 1850 ms（第一句通常较短，会偏小） |
| 播放 | 约 30 ms | 约 30 ms |

不算模型和 webview 装配，光 VAD + ASR + TTS + 播放就有约 2.2 s 下限、约 3.2 s 典型；加上模型，用户感受到的大概是 5–8 s。这是推算，要真机量才能确认。

打断延迟：duck 约 100–200 ms（一个缓冲），真正停播约 400–500 ms（duck + 300 ms 确认）。每轮放音的头 2 s 根本打断不了；中途合成跟不上导致播放跑空时会 `stop()`，下一句来时重新 begin，又开一个 2 s 免疫期（`SpeechOut.swift:822`、`:852`，读代码所得，没实测过）。

## 3. 噪声场景为什么不行（都是从代码推出来的）

判据只有一个：单个缓冲的 RMS ≥ -35 dBFS 就算有人说话。这个阈值是在安静房间、手持、iPhone 16 上拟合的（静音中位 -75、人声中位约 -24、回声最高 -38.5；docs/info/33:195、:206）。没有底噪估计，没有人声和噪声的区分，也没有说话人判断。docs/info/33:189 明确写着第一版默认安静环境，兜底靠模型自己不回答。

- 持续底噪 ≥ -35：用户说完以后 hangover 一直被刷新，轮次永远不结束，`speech-end` 不发，AI 永远不回答，也没有轮次时长上限（`turn-detect.ts:266-279`）。
- 底噪在 -35 上下波动：每次越线都 duck，播放音量掉到 0.25，300 ms 后 resume，再隔 300 ms guard 又能 duck，听起来就是音量一直在抽。用户停顿时的噪声尖峰会刷新 hangover，回答被继续往后推。
- 噪声或旁人说话持续 ≥ 300 ms，而且落在 AI 说话的 2 s 之后：判成打断，当场停播，模型回合被 abort（`voice-session.ts:229-243`、`:332-345`）。如果识别器在这个窗里没识别出字，`speech-end` 是空串，就不会再发问，回到 listening（`:363-372`）。AI 这一轮回答就丢了，屏幕和声音上都没有任何交代。
- 用户问完、AI 还在思考（还没出声）时有噪声：这时没有放音，也就没有免疫期，单个缓冲越线就 duck，300 ms 后 stop，`cut()` 把正在跑的模型回合 abort 掉（`voice-session.ts:229-233`）。用户的问题已经在线程里，但答案被扔了；新一轮如果是空串就不会再问。结果就是用户问了一句，AI 一直不吭声。
- 旁人说话：只要够响，就跟用户说话一模一样，开轮、打断、内容进转写送给模型。不够响的旁人说话，只要落在用户轮次窗 ±300 ms 内，也会拼进用户那句（`ConversationRun.swift:646-670`）。
- 回声：AI 说话 2 s 以后残余回声离阈值只有 3.5 dB（-38.5 对 -35，08-15 摆位）。09-05 换了摆位，识别器就写下了手机自己的声音。外放音量更大、手机平放离人一米（docs/info/33:326 推测的产品摆位）、或者用 iPad，都没测过。人离得远时人声也更接近 -35，漏检和误检会同时变多。
- 短回应：短于 300 ms 的「嗯」「对」只会 duck 再 resume，拿不到轮次（`turn-detect.ts:60-71` 注释里自己写了这个代价）。

## 4. 串行与本可重叠

现在全部串行：hangover 1250 ms → finalize → 事件 → quiet() 等别的回合 → prepareInfoTurn 装配 → durable 起回合 → 模型思考/工具 → 写到第一个「。」 → 第一句**整句**合成 → 播放。

本可以重叠却没有的：

1. 抢跑模型。说话期间 volatile 一直在出（docs/info/33:184），但模型只在 hangover 和 finalize 之后才起。可以在静音 300–500 ms 时拿 volatile 先发请求，用户接着说就取消。
2. 装配前移。`prepareInfoTurn`、`quiet()`、工具构建都可以在用户说话期间先做好，现在是 `speech-end` 之后才开始（`info-voice.ts:290-330`）。
3. 第一句等整句才播。首帧 p50 628 ms 就到了，但要等整句收全（p50 1853 ms）才交给播放器（`README.md:186`）。句首可以即时裁，只是句尾要等，单看第一句这里就差约 1.2 s。
4. 切句等句号。第一句的软边界提前发被冻结规则架空了：没出现 `。！？；：` 加下一个字之前，一个字都进不了 TTS（`split.ts:96-108`）。英文回复更糟，要等换行或整轮结束。
5. 开场预合成 `OpeningCache` 写好了没接，开场白照样走一遍完整的模型加 TTS。docs/info/33:135 写的「853 ms 变成 0」在生产路径上不成立。
6. 没有语音专用的模型档和提示词。语音轮用文字聊天的模型、思考档、全套工具和整条历史，首 token 和文字聊天一样慢。
7. 打断之后，下一轮要等被 abort 的那一轮落盘结束才开始装配（坑 529 的解法，`info-voice.ts:229-244`），这段时间也是串行加在上面的。
8. 所有 webview 效果（`speak-push`、`volume`、`speak-stop`）都排在一条 promise 链上逐个 await（`voice-call.ts:212-218`），一个慢的原生命令会挡住后面的句子。影响小，记一笔。
