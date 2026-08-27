# 模拟器的 input node 报 0 Hz，共用采集栈的播放路径在模拟器上一句都放不出来

## 现象

iPhone 17 模拟器（iOS 26.5），app 已经 `simctl privacy grant microphone`，
`AVAudioSession` 配成 `.playAndRecord` / `.voiceChat` 也没报错，
`setVoiceProcessingEnabled(true)` 正常返回（实测 45 ms），然后：

```
RP-DICT voiceProcessing +97ms
RP-DICT microphone=0Hz 1ch deinterleaved fmt=1
RP-SPEECH enqueue failed: The microphone did not open. The audio session never became active.
```

`inputNode.outputFormat(forBus: 0)` 的 `sampleRate` 是 0。因为播放节点挂在
采集那台引擎上（一台开着 VPIO 的 engine 同时收音和出声），建栈在读输入格式那
一步就被自己的断言拦下，播放跟着一句都放不出来。

## 原因

模拟器没有输入硬件。`setCategory` / `setActive` / `setVoiceProcessingEnabled`
三步都成功，只有真正问硬件要格式时才暴露——0 Hz 是「没有设备」的答案，不是
错误。既然采集和播放共用一台引擎，采集起不来就等于播放起不来。

## 解法

模拟器上验不了这条路径，别拿模拟器全绿当真机能起来的证据。模拟器上能验的是
命令分发、参数解码、事件订阅、错误回传这些纯软件的接线；音频本身要真机。

要在模拟器上跑完播放实验只有一条路——给播放单独建一台不碰 `inputNode` 的
engine——那是另一种图形，测出来的数不能外推到真机（真机上决定输出链的是
`mainMixerNode` 第一次被读到的时机，见坑 [133](./133-a-rebuilt-vpio-unit-answers-with-a-default-output-format.md)，
而那台图根本不会触发它）。所以不做。
