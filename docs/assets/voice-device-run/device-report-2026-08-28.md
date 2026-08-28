# M-voice-2 真机第三轮

分支 `worktree-agent-acc8aa81162eb7035`，两个提交接在 `4fdddcb7` 之后：

- `3ab80f29` 三条日志通道 + boot 标记 + route survey
- `65faa80c` 设备半程可以按路径接收 .ipa

## 第二轮怎么死的：查清了

**装上去的包是正式 bundle id，不是 `.dev`。** `tauri ios build` 每次都从 `tauri.conf.json` 重新生成
`gen/apple`，上一轮那两条 sed 改的是生成物，被覆盖掉了；日志里那句
`PRODUCT_BUNDLE_IDENTIFIER: com.xinyuan.readingpartner.dev` 是从生成物 grep 出来的，不是 `.ipa` 里的真值。
从 `.ipa` 的 `Payload/Reading Partner.app/Info.plist` 读回 `CFBundleIdentifier`，我自己按老办法编的两个包也一样
是 `com.xinyuan.readingpartner`。

所以第二轮实际发生的是：新包顶掉了用户的正式版，而
`devicectl process launch com.xinyuan.readingpartner.dev` 拉起来的是八月留在机器上的**旧 `.dev` 包**——那个包里
没有 speech 探针，所以容器里不会有 `speech/`，也不会崩，也不会有崩溃报告。第一轮没这个问题是因为它本来就用正式 id。

修法是另一个 agent 那条（`worktree-agent-a35de5852d02c6c31` 的 `6a8f5bea`）：把 `--config` 文件
`{"identifier": "com.xinyuan.readingpartner.dev"}` 传给 `tauri ios init` 和 `tauri ios build`，再从 `.ipa` 的
Info.plist 读回来校验，不是 `.dev` 就拒绝安装。已经合进本分支。

另外，付费团队签的新 `.dev` 包装不到手机上的旧 `.dev`（Personal Team 签的）上面去，iOS 报
`MismatchedApplicationIdentifierEntitlement`，必须先 uninstall。uninstall 会连麦克风权限和容器一起清掉。

## 排除掉的那几条（不用 syslog 就能查）

不解锁手机就能查的部分（读 Mac 上的 `~/live5.log` 和 `~/crash/`）：

- **不是崩溃。** `idevicecrashreport` 在第二轮结束后一分钟又拉了一次，拉回来的最新报告里有
  `WiFiLQMMetrics-2026-08-28-103745.ips`，说明当天的新报告确实会被拉到；Reading Partner 的报告仍然只有第一轮那
  两个（`-140053.ips` / `-140347.ips`，手机本地时间，对应 Mac 的 23:00 那一轮）。
- **不是内存被杀。** `~/crash/` 里 JetsamEvent 最新的是 `2026-08-11`，8-28 一个都没有。
- **死得比"没写完"更早。** `live5.log` 的容器清单里 `Library/Application Support/com.xinyuan.readingpartner.dev/`
  下有 `device.json`、`settings.json`、`smoke/`（四个旧的 dictation 结果）、`speech-fixture/`（这轮推进去的 24 个
  clip）、`voice-probe/`（八月中旬的旧文件），**没有 `speech/`**。而 `speech-run.sh` 会先启动一次 app 建数据目录、
  睡 12 秒再 kill——那 12 秒里探针本来该 mkdir 完并写第一份 JSON。也就是说两次启动、总共 650 秒，JS 一次都没走到
  `mkdir`。

剩下的可能只有两类：webview 根本没跑起来（或在第一行就抛了），或者 app 被切到后台/被系统收走。两轮都没有任何一侧的
日志，所以这一轮先把日志补齐再跑。

## 这一轮加了什么

**三条日志通道，全部在碰 app 之前就起**（都在 `speech-run.sh` 的设备半程里）：

- `rp-run3.app.log` — `idevicesyslog -p "Reading Partner"`，我们自己进程的一切，`RP-SPEECH` / `RP-DICT` 从这里出。
- `rp-run3.sys.log` — `idevicesyslog -m readingpartner`，别人对我们的 bundle id 说的话。runningboardd 把 app 收走
  会记在这里。
- `rp-run3.console` — `devicectl process launch --console`，进程自己的 stdout/stderr，而且它会等到进程退出，所以
  这份日志的最后一行和 mtime 就是"几点没的"。

两条 syslog 都在中继侧过滤（坑 163）。

**探针自己留脚印**：`runSpeechProbe` 第一件事就是写 `stage: "boot"` 的结果文件，然后每换一个 stage 写一次并 NSLog
一次；`window.onerror` 和 `unhandledrejection` 抓到的东西也写进同一个文件。JS 里的 `note()` 走
`speech_probe` 的新 `mode: "note"`（不进串行链，否则一条脚印要排在 75 秒的腿后面）。`VoicePlugin.init()` 里调
`SpeechProbe.watchLifecycle()`，开机打一行 `RP-SPEECH native up`，之后每次生命周期切换打一行。全是 `#if DEBUG`。

这样下一轮无论怎么死，都能分清三种：native 都没起来（连 `native up` 都没有）、webview 没起来（有 `native up` 没有
`webview up`）、被切后台（有 `lifecycle didEnterBackground`）。

**蓝牙改成实测**：`SpeechProbe.surveyRoutes()` 在第一条腿之前跑，用一个临时 session 和一个临时 engine 依次试六组：

| name | mode | options |
| --- | --- | --- |
| shipping | .voiceChat | .defaultToSpeaker |
| voiceChat+hfp | .voiceChat | .allowBluetooth |
| voiceChat+a2dp | .voiceChat | .allowBluetoothA2DP |
| voiceChat+a2dp+speaker | .voiceChat | .allowBluetoothA2DP, .defaultToSpeaker |
| default+a2dp | .default | .allowBluetoothA2DP |
| videoChat+a2dp | .videoChat | .allowBluetoothA2DP |

每组记整行 route（`cat= mode= opts= out= in= rate= available=`）、setCategory 成没成、以及在那条路由上
`setVoiceProcessingEnabled(true)` + `engine.start()` 起不起得来。`rate` 是判 profile 的依据：HFP 8k/16k，A2DP
44.1k/48k。跑完把 session 恢复原样并 setActive(false)，正式的腿从原来的地方开始配置。

结果落在 `speech-result.json` 的 `routes.trials`，也同步 NSLog 一行 `RP-SPEECH route <name> vp=<0|1> <route>`。

**构建和用手机分开**：`speech-run.sh` 认 `PHASE=build|device|all`，`IPA_PATH` 可以指定 .ipa。这一轮两个包都在手机
锁着的时候编好了（`~/ipa-speech-live.ipa`、`~/ipa-dictation-bench.ipa`），解锁窗口里只装机、跑、取。

`FRESH=1` 可以在装机前清容器，但**这一轮没用**：uninstall 会连麦克风权限一起清掉，无人值守的一轮没人去点"允许"。

## 蓝牙：六组的运行时真值

REDMI Buds 6 Pro 连着跑的，VPIO 六组全部起得来（`vp=1`），所以 VPIO 不是限制因素。

| 组 | opts | out | in | rate |
| --- | --- | --- | --- | --- |
| shipping（`.voiceChat` + `.defaultToSpeaker`） | 8 | Speaker/Speaker | MicrophoneBuiltIn | 48000 |
| voiceChat + `.allowBluetooth` | 4 | BluetoothHFP/REDMI Buds 6 Pro | BluetoothHFP/REDMI Buds 6 Pro | 16000 |
| voiceChat + `.allowBluetoothA2DP` | 32 | Receiver/Receiver | MicrophoneBuiltIn | 48000 |
| voiceChat + A2DP + defaultToSpeaker | 40 | Speaker/Speaker | MicrophoneBuiltIn | 48000 |
| default + A2DP | 0 | Receiver/Receiver | MicrophoneBuiltIn | 48000 |
| videoChat + A2DP | 32 | Speaker/Speaker | MicrophoneBuiltIn | 48000 |

shipping 那组的 `available` 里只有内置麦克风，蓝牙端根本不在候选里——「音频走外放」是实测确认的，不是推断。

**「A2DP 输出 + 内置麦克风输入 + VPIO 开」不成立。** 不是 `.voiceChat` 和 A2DP 互斥：`.default` 和 `.videoChat`
加 A2DP 一样，输出落到 Receiver 或 Speaker，蓝牙端从 `available` 里整个消失。互斥的是「这个 session 要录音」和
A2DP——只要 category 是 `.playAndRecord`，iOS 就不把 A2DP 端拿出来，加不加 `.defaultToSpeaker` 只决定落听筒还是
落外放。

唯一能让耳机出声的是 `.allowBluetooth`，代价是 HFP 16 kHz，而且输入也一起被拿走（in 也变成
`BluetoothHFP/REDMI Buds 6 Pro`）。取舍只有两档，中间没有第三档：外放 48 kHz 耳机没声，或者耳机有声但双向窄带。
想要 A2DP 高音质就得让 session 不录音，也就是放和听不能同时。这一条要项目发起人拍板。

## 四个实验：三个有数，一个没跑到

这一轮 `speech-result.json` 停在 `stage: "echo-vpio-off"`，三条夹具腿全部 `ok=true`、三卷录音都拿到了，echo 那两
条和 live 腿、中断腿都没跑到——app 在切 VPIO 那一下 abort 了（见下面「崩溃又来了」）。

判读用 `RP_REPO=<本分支worktree> python3 bin/judge.py .`。

### E1 接缝：过（但原来那条判据本身是错的）

| | 录到 | 对照 | 差 |
| --- | --- | --- | --- |
| trimmed-burst | 1802400 样本 / 75.10 s | 1801440 / 75.06 s | +960 样本（40 ms） |
| trimmed-measured | 1802400 / 75.10 s | 1801440 / 75.06 s | +960 |
| raw-burst | 1956000 / 81.50 s | 1954560 / 81.44 s | +1440（60 ms） |

- 十二句之间没有插进去的静音块：整段只多 40 ms，一个句间空隙至少要几百毫秒才看得出来。
- 每个接缝 10 ms 窗的峰值都没有比相邻窗高 20 dB，**11 个接缝一个都没超**。
- 逐样本对照 `identical 630/1801440`（0.035%）——**这条判据不成立，要废掉**。engine 跑在 48 kHz，夹具是
  24 kHz，播出去和录回来各重采样一次，逐样本相同在物理上就不可能。有效的替代判据是 10 ms RMS 包络的互相关：
  **0.9956，恒定滞后 7 帧（70 ms）**，滞后不随时间漂。70 ms 就是 tap 比第一块 buffer 早开的那一段
  （`firstTapFrames=2400`，正好 100 ms）。
- 人耳那半：项目发起人在现场听外放判过，接缝的音高语速、句间 160 ms 的换气长度、裁静音有没有削掉字头字尾，
  三条都说没问题。**这一条只覆盖 48 kHz 内置路由这一档**，蓝牙走 HFP 16 kHz 之后要重听一次。

### E2 playerTime：过

三条腿各 12 句，`latencyMs` 全为正，**没有一个负值**：

| 腿 | min | max | mean |
| --- | --- | --- | --- |
| trimmed-burst | 24.00 | 44.00 | 34.50 |
| trimmed-measured | 24.00 | 44.00 | 34.50 |
| raw-burst | 23.00 | 45.00 | 33.33 |

量级对得上：`outputPresentationLatencyMs=0` + `sessionOutputLatencyMs=8.54` + `ioBufferDurationMs=23` = 31.5 ms，
实测均值 33-35 ms。离散度 ±10 ms，量级就是一个 IO buffer。

`completedAtMs` 相对夹具自己的时钟，全程 75 s 的漂移在 **-24 .. +10 ms** 之间，而且不随句序单调增长（trimmed-burst
是 0,-2,3,-13,-14,-17,-10,-7,0,-17,-17,-7）。时间轴和音频同速。

### E3 回声：判不了

两条 echo 腿都没跑到，`echo` 数组是空的。app 在 `echo-vpio-off` 那一步 abort。

### E4 包络：过

| 腿 | levelDb p10/p50/p90 | 映射后 p10/p50/p90 | 贴 0 | 贴 1 |
| --- | --- | --- | --- | --- |
| trimmed-burst | -31.2 / -18.9 / -14.4 | 0.280 / 0.681 / 0.825 | 64/752 | 0 |
| trimmed-measured | -31.2 / -18.9 / -14.4 | 0.280 / 0.681 / 0.825 | 64/752 | 0 |
| raw-burst | -49.9 / -19.2 / -14.5 | 0.000 / 0.670 / 0.823 | 122/816 | 0 |

对桌面拟合的 -32.6 / -18.9 / -14.4：p50 和 p90 完全一致，p10 差 1.4 dB。映射后没有一处贴 1，贴 0 的只有静音段
（raw 腿多是因为它保留了供应商的静音）。`levelIntervalMs` 在 ~92 和 ~115 ms 之间交替，中位数约 100 ms；
`firstTapFrames=2400`，正好是判据里写的那个数。

## 崩溃又来了：坑 198 的解法不够

`Reading Partner-2026-08-28-152247.ips`（本目录 `crash-152247.ips`），SIGABRT，栈的上半截和第一轮一模一样：

```
AVFAudio  AVAudioEngineGraph::RemoveNode(AVAudioNode*, NSError**)
AVFAudio  -[AVAudioNode didDetachFromEngine:error:]
AVFAudio  -[AVAudioEngine detachNode:]
Reading Partner  AudioFront.teardownLocked()
Reading Partner  AudioFront.close()
Reading Partner  static SpeechProbe.setVoiceProcessing(_:)
```

这次 engine 已经停了，tap 和 player 也都停了——坑 198 那条「先停 engine 再 detach」的顺序照做了，还是抛。触发点也
换成了主动 `close()`（探针切 VPIO），不是路由变化。

解法改成**根本不 detach**：摘 tap、停 player、停 engine，然后 `self.engine = nil` 让整张图跟着释放。记进坑 199。

## 日志通道验证了

三条通道都出数，`RP-SPEECH` 一行不落：

- `rp-run3.app.log`（3.9 MB）：`native up` → `lifecycle didFinishLaunching` → `webview up, stage=boot` →
  `stage=routes` → 六条 `route` → 每条腿一行 `stage=`。
- `rp-run3.sys.log`（4.5 MB）：runningboardd / watchdogd 对我们 bundle id 的状态更新，`isUserKill` 也在里面。
- `rp-run3.console`：`App terminated due to signal 6`，直接说了是 abort。

`device5.log` 里那一串 `GONE` 是**假阴性**，别信：`--console` 挂着的时候再并发调
`devicectl device info processes` 查不到进程，而同一时刻 app 还在按秒打日志。这个健康检查要换个做法或者删掉。
