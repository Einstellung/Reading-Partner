# 612 第一次读 `inputNode` 会停掉正在跑的 engine

## 现象

iPad 上跑静默语音测试，通话的第一句（开场白）8 次全听不见：`speech:speaking=1` 照发，`audible-start` 不来，`output.wav` 从开场白那一刻到下一句回复整段缺失。紧跟 `node.play()` 读 `engine.isRunning` 已经是 false，player 的 `isPlaying` 也是 false，`lastRenderTime` 是 nil；`AVAudioEngineConfigurationChange` 不发，会话也没有中断或路由变化。下一句回复时 `speakerEngine()` 发现 engine 停了，重新 `start()`，从此每句都正常。

把 player 的 tap 挪到 `engine.start()` 之前，现象不变。

## 原因

测试台的栈（`openHarnessLocked`）是 `.playback` 会话，从头到尾不读 `engine.inputNode`，因为第一次读它就会建出输入单元。`SpeechOut` 第一句 `play()` 前有一行只在 DEBUG 里编的图日志，参数里带了 `engine.inputNode.isVoiceProcessingEnabled`。.dev 包是 debug 配置，这一读就是这条 engine 上第一次读 `inputNode`。

探针（run `zh-chat-then-delegate-2026-10-15T08-14-59-964Z`）在那一读前后各读一次 `isRunning`：

| 第几次读 | 读之前 | 读之后 | 耗时 |
| --- | --- | --- | --- |
| 第一次（开场白） | running | **stopped** | 17.7 ms |
| 之后每一次 | running | running | 0.002-0.006 ms |

engine 是被这一读静默停掉的：没有异常，没有通知，`start()` 之后再读也不会再停。之前一直以为是 `play()` 停的，是因为日志里 `running=1` 这个参数排在 `inputNode` 前面求值。

真麦克风的栈在 `engine.start()` 之前就读过 `inputNode`（要开 voice processing），所以不中招。TestFlight 是 release 配置，这行日志不在里面，用户的开场白不受影响。

## 解法

engine 起来之后不许第一次碰 `inputNode`，日志也不行。`SpeechOut` 第一句前的图日志去掉了 `vpio` 那一项。要知道 voice processing 开没开，在建栈时（`start()` 之前）读。
