# 轮次装机轮 2026-09-05

iPhone 16、iOS 26.6、全程 WiFi，云签名 `.dev` 包，从 main `90b407dc`（0.12.0）在 Mac mini 上构建。
三条腿各是一次 smoke 构建（`VITE_SMOKE=turn-replay` / `speech-live` / `turn`），三个 ipa 都读回
`com.xinyuan.readingpartner.dev`。原始数据在同目录的 `turn-replay-2026-09-05.json`、
`speech-result-2026-09-05.json`、`turn-result-2026-09-05.json`。结论在 [33](../../33-语音简报.md)。

## B 腿 turn-replay：Swift 和 TS 逐位相同

17 个用例喂同一串电平帧，`failed: 0`，每个用例的 `differences` 都是空。4 个用例两侧都是零事件
（`echo-default`、`echo-loose-50-two-frames`、`vpio-off-barge-default`、`timer-digital-silence`），
其余 13 个各 2–8 个事件，逐位相同。

## C 腿 speech-live：第一遍 12 句没成，授权之后重跑全过

```
sentences=12 failed=12 queued=0 chars=434 model="mimo-v2.5-tts" voice="冰糖"
concurrency=2 gapMs=160 prefetchMs=6000
```

25 条 timeline：12 条 `started`、12 条 `failed`、46.95 ms 一条 `drained`。没有 `firstAudio`，
所以逐句的请求到首帧、裁剪、播放器余量这一轮一个数都没有。

12 条错误一字不差：

```
the voice service could not be reached: error sending request for url (https://api.xiaomimimo.com/v1/chat/completions)
```

立刻失败，不是超时。第一句 0.81 ms 发出、15.02 ms 失败，第二句同批 1.05 ms 发出、15.04 ms 失败；
后面十句在开跑后 2.54–3.99 ms 内失败。`synthesize_with_retry`（`plugins/voice/src/tts/mod.rs:54-69`）
没有退避，三次尝试背靠背，每次约 1 ms 就回来。

失败点是 `.send()`（`plugins/voice/src/tts/mimo.rs`）。当时的 `transport()` 只留
`reqwest::Error::to_string()`，source chain 丢了，所以记录里分不出 DNS、connect 和 TLS。
这条已经修了，`describe_chain`（`tts/error.rs`）现在把整条链拼进 message。

真因是国行 iPhone 上新装的 app 没在 设置 → 无线数据 里授权，请求根本没离开手机。错误串看不出这件事，
是坑 217。用户授权之后重跑了一遍，12 句全过，见下。

key 的递送没问题：`MIMO_API_KEY` 那道闸没有触发，key 只经 `DEVICECTL_CHILD_MIMO_API_KEY` 进去；
key 的问题会以 401 的 `Status` 错误回来，不是 transport。手机直连 `api.xiaomimimo.com` 通不通这一轮
仍然答不了——Mac 上 `curl` 回 401、TLS 0.139 s、名字解析到 `198.18.0.112`（fake-ip），
Mac 是经自己的 Clash 到 `127.0.0.1:7890` 出去的，那个数不能替手机回答。

同一轮还真的：

- 三条夹具腿全过：`trimmed-burst` 75.6 s / 753 个电平事件、`trimmed-measured` 77.1 s / 752、
  `raw-burst` 81.8 s / 816，都以 `speaking:0 reason=done` 收尾。
- live 腿的 `ok:false` 有一半是探针的事：`watch()`（`src/smoke/speech-probe.ts:221`）按 webview 收到
  `speaking:0` 判成功。`SpeechOut` 对每个进了 `enqueue_speech` 的句子都会发 `speaking:1/0`，live 路径
  也一样；但这一遍 12 句全失败、一句都没排上队，于是没有任何事件能结束这条腿，只能等满
  180 秒（`wallMs=180070`）。重跑那遍证实事件照常到（`speaking:1` 在 1619 ms、`speaking:0 reason=done`
  在 80227 ms，`ok: true`），所以这是「一句都没播」的缺口，不是这条腿判不了。
  已改成按 relay 的结果判定、relay 一结束就收腿。
- `live.pcm` 不存在，`capturedFrames: 0`，和"一个字节音频都没排上队"一致。
- 坑 203 的改序有效：live 腿在进程死掉之前就写到盘上了。`speech-result-2026-09-05.json` 停在
  `stage: "echo-vpio-off"`、`echo: []`，console 最后一行 `App terminated due to signal 6`。
  那条腿仍然 abort，只是不再挡住 live 腿。

### 重跑：12/12 合成并播出

授权之后 08:37 重跑一遍，数据在 `speech-result-2026-09-05-run2.json`。

```
sentences=12 failed=12 → failed=0 queued=12  每句 attempts=1
ok:true  wallMs=80256  786 条 level  speaking 1@1619ms  0 reason=done@80227ms  underruns=0
```

| | min | p50 | max |
| --- | --- | --- | --- |
| 请求 → 首音 | 375 | 628 | 1031 |
| 请求 → 整句收全 | 860 | 1853 | 2855 |
| 排队时播放器余量 | 3090（第一句） | 10524 | 13317 |
| 裁头 | 40 | 70 | 90 |
| 裁尾 | 180 | 410 | 480 |

12 句共裁掉 5590 ms，82080 → 76490，6.8%。`headCapped` 12 句全 false。

和桌面比：

- 请求到首音 p50 628 ms 对桌面小米 38 句的端到端首帧 p50 687 ms，同量级。
- 裁尾 p50 410 ms 对桌面量到的句尾静音 451 ms，对得上。
- 裁头 p50 70 ms 小于桌面的句首静音 117 ms，是坑 191 定的 40 ms 句首护栏在挡。
- 整句最慢 2855 ms 比桌面的 2402 多 450 ms，但余量最小的一句是 3090 ms，接力没被追上，`underruns` 0。

整轮第一个可闻的字在腿起点后 1619 ms。手机没挂代理，`api.xiaomimimo.com` 直连是通的。

重跑仍然死在 `echo-vpio-off`（坑 203 未修），文件同样停在那个 stage。

## A 腿 turn probe：三个问题都有答案

`ok: true`、`stage: "done"`、`error: null`，时间戳 2026-09-05T08:16:32Z。app 由人手动拉起
（没走 `turn-run.sh` 的 launch），夹具已经在容器里。3 次朗读不是 5 次：只跑了 medium 一档（71.7 s），
`sweptSensitivity: false`，原因文件里记着——`the medium pass reported no detector results, so there is
nothing a level can change`。

采集：`analyzerFormat 16000Hz 1ch`、`tapSampleRate 48000`、`voiceProcessing true`、`locale zh-CN`，
路由 `in=[MicrophoneBuiltIn] out=[Speaker]`。摆位是手持、正常发语音的距离（用户口述，代码不规定距离）。

### 1. `SpeechDetector` 一条结果都不报

`detectorAttached: true`、`reportResults: true`、`detectorEvents: 0`、`detectorStreamEnded: true`。
挂得上、要了结果、71.7 秒零结果、序列自己结束（detector 流和转写流同在 71694 ms 结束）。
按 33 的说法这是答案，不是失败。

### 2. `finalize(through: nil)`：调用 50 ms，快约 0.78 s，不丢字

同一句读两遍，两条转写逐字相同：`我们明天上午 9:00在图书馆门口见面吧`（数字和冒号是识别器写的）。

```
32608 finalize called   volatileAtCall="我们明天上午 9:00在图书馆门口见面吧"
32651 FINAL  [24960-30720] 我们明天上午 9:00在图书馆门口见面吧
32658 finalize returned  callMs=50.31
```

调用占 50.3 ms，定稿在发起后 43 ms 到（比调用返回还早）。定稿文本等于发起那一刻的 volatile，没有损失。
自然那遍：定稿 47139 ms、`[38666-44426]`、同一句。

对齐之后（电平的 `audioMs` 和墙钟差一个常数 703 ms，所以 tap 全程没有卡过）：从定稿覆盖到的音频末尾算到
定稿落地，强制 1228 ms 对自然 2010 ms，强制快约 780 ms。

一处差别：自然那遍把句号当成独立一段（volatile `。` 在 48130 ms，51935 ms 定稿，那时已经进 duplex 段），
强制那遍的定稿没有句末句号。

### 3. 电平分布

一个缓冲区一条记录（4800 帧），实测间隔中位数 92 ms ≈ 10.9 Hz，708 条，dB = 20·log10(inputRms)。

| 段 | n | min | p10 | p50 | p90 | max | ≥ -35 dB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 静音 | 30 | -81.6 | -77.3 | -75.3 | -73.8 | -53.6 | 0/30 |
| 手机自己放音（整段） | 217 | -111.6 | -105.5 | -101.8 | -71.2 | -28.7 | 4/217 |
| 人，强制那句的音频跨度 | 58 | -77.3 | -76.7 | -23.8 | -14.8 | -12.9 | 39/58 |
| 人，自然那句 | 58 | -77.3 | -75.8 | -23.8 | -16.1 | -14.1 | 37/58 |
| 人，duplex 那句 | 48 | -106.8 | -78.1 | -23.3 | -17.8 | -16.0 | 33/48 |

（三行"人"取的是各自定稿的音频跨度，里面含首尾空白，所以 p10 在 -75 上下；有声帧集中在 -24 到 -13。）

对着 08-15 拟合的 `DEFAULT_TURN_DETECT`（`startDb -35`、`startFrames 1`）：

- 静音守得住，余量很大：底噪中位数 -75 dB、最大 -53.6，离阈值 18 dB。
- 人声守得住：峰值 -13 到 -16，有声帧中位数约 -24。
- 手机放音守不住：过 -35 的 4 帧全在放音开始后 4200–5188 ms（-28.7、-33.9、-31.7、-33.6），
  同一段另有 5 帧在 -37 到 -44（3900、4109、4291、4408、5098 ms）。从 5188 ms 到这一段结束的
  25396 ms，没有一帧超过 -45 dB。也就是 VPIO 有约 1.6 秒的收敛窗，窗内 `startFrames: 1` 每一帧都会
  起一次 duck。抬 `startFrames` 还是给放音开头一段免疫期，没定。
- duplex 那句人说完之后（60638 ms 起）还有 3 帧过 -35（最大 -17.1，最后一帧 63791 ms）。
  是人声的尾巴还是泄漏，这份数据分不出来。

### 三个问题之外的一条

VPIO 开着，识别器把手机自己放的那段写下来了：`played` 段两条定稿，`说好你`（音频 2880-5760）和
`。`（6720-8640），整条转写就从 `说好你。` 开头。08-29 那条 echo 腿一个字都没写下来。
摆位或音量变了，结论跟着变了。

## 和 README / 坑清单说的不一样的

1. Mac 上的 `linux` remote 指着 `ssh://xinyuan@172.20.10.10/...`（坑 202 那个热点网段），Linux 现在是
   192.168.0.107。症状是 `Connection closed by 172.20.10.10 port 22`——那个地址上有别的东西在应答，
   不是超时。改了 Mac 上的 remote URL。这是这一轮在 Mac 上做的唯一配置改动。记进坑 216。
2. WiFi 下的 `idevicesyslog` 是个空转：不报错、不退出，只打一行
   `Waiting for device with UDID … to become available...` 然后挂着。后果是 `.app.log` / `.sys.log`
   永远停在那一行，脚本里那个 `last line Ns ago` 计数从文件创建时刻起单调增长，读起来像 app 早就死了
   （C 腿爬到 667 s，而 app 一直活到自己 SIGABRT）；`idevicecrashreport` 也什么都拉不到
   （`~/crash` 最新的还是 08-29）。脚本不会失败：`pgrep -fl idevicesyslog` 找得到那个等待中的进程，
   `set -euo pipefail` 不触发。判活要改看 `--console` 那份日志。记进坑 214。
3. 手机上没有正式包：`devicectl device info apps --include-all-apps` 列出 111 个 app，只有
   `com.xinyuan.readingpartner.dev` 对得上。不是这一轮造成的（三次安装读回的都是 `.dev`），
   但 TestFlight 版现在不在机器上。
4. 国行 iPhone 上新装的 app 第一次联网前要在 设置 → 无线数据 里授权，没授权的请求约 1 ms 内以 transport
   错误失败，错误串看不出原因。C 腿 12/12 失败就是它。记进坑 217。
5. 一句都没排上队时，live 腿没有任何事件能结束它（见 C 腿）。
6. 传输错误丢掉 source chain（当时的 `transport()`）。已修，见 `tts/error.rs` 的 `describe_chain`。
