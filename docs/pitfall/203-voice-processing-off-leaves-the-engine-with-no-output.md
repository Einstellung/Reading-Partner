# 203 关掉 VPIO，engine 就没有输出硬件了，`play()` 报 disconnected

## 现象

真机跑 E3 的阳性对照腿 `echo-vpio-off`，`AVAudioPlayerNode.play()` 抛 ObjC 异常、进程 abort：

```
Terminating app due to uncaught exception 'com.apple.coreaudio.avfaudio',
reason: 'player started when in a disconnected state'
```

节点是刚新建、刚 attach、刚 connect 的，图在账面上是全的。同一轮三条腿横着比，每条只放一句：

| 腿 | 建之前拆过栈 | VPIO | `outHw` | `mixerFmt` | 结果 |
| --- | --- | --- | --- | --- | --- |
| trimmed-burst | 否 | 开 | 48000Hz 1ch | 48000Hz 1ch | 好 |
| echo-vpio-on | **是** | 开 | 48000Hz 1ch | 48000Hz 1ch | **好** |
| echo-vpio-off | 是 | **关** | **0Hz** | 44100Hz 2ch | **崩** |

崩的那一刻读回的图（`nodeOut` 是 player 往后的连接数，`mixerOut` 是 mainMixer 往后的）：

```
build connect ok nodeOut=1 mixerOut=1 vpio=0 running=0 mixerFmt=44100Hz 2ch outIn=44100Hz 2ch outHw=0Hz 2ch
build start   ok nodeOut=1 mixerOut=1 vpio=0 running=1 mixerFmt=44100Hz 2ch outIn=44100Hz 2ch outHw=0Hz 2ch
graph attached=1 nodeOut=1 mixerOut=1 running=1 vpio=0 nodeFmt=24000Hz 1ch mixerFmt=44100Hz 2ch outHw=0Hz 2ch rate=48000
```

拆栈重建不是变量：`echo-vpio-on` 同样先 `front closed` 再重建，好的。前四轮把原因记在「先拆栈再重建」上，
是因为唯一会崩的那条腿同时也是唯一关 VPIO 的腿，两个变量一直绑在一起。

## 原因

`engine.outputNode.outputFormat(forBus: 0)` 是 **0 Hz**——这台 engine 没有输出硬件。

VPIO 开着时，`setVoiceProcessingEnabled(true)` 花掉的那 450 ms 就是 voice-processing I/O 单元把采集和播放两个
方向一起绑上硬件。关掉它是近乎零耗时的空操作（`RP-DICT voiceProcessing` 和 `RP-DICT inputNode` 打在同一毫秒），
只有输入那半被 `engine.inputNode` 拉起来，输出那半没人去建。

`mainMixerNode` 是懒创建的，第一次读它才建、并按 `outputNode` 的格式接过去。`outHw` 是 0，于是它退回
AVAudioEngine 的兜底 44100 立体声。连接数全对是因为连接是**声明**出来的：`nodeOut=1 mixerOut=1` 只说明
connect 调用成立，不说明这条链进了渲染图。`play()` 检查的是节点在不在输出链里，答案是不在。

`engine.start()` 返回、`isRunning` 为 true 也不能反证：输入链（麦克风的 tap）是活的，engine 有理由跑。这比
坑 132 更阴——那次 `isRunning` 直接是 false，这次它是 true，只有输出格式泄露。

## 解法

未修。判据是 `engine.outputNode.outputFormat(forBus: 0).sampleRate == 0`——建完图之后这个数是 0，就说明输出链
没绑上设备，后面 `play()` 一定 abort，`isRunning` 和连接数都别信。

边界：产品路径上 VPIO 永远开着（采集和播放共用同一个 voice-processing 单元是 AEC 参考信号正确的前提，见
`docs/33`），所以这条只影响 E3 的阳性对照腿。要修的话方向是「关 VPIO 时输出侧该由谁去绑硬件」，不是
`start()` 之后断言采样率不等就重建——重建本身就是这条路径上出问题的动作。

`AudioFront.openFreshLocked` 里 attach + connect 那一段是现场：`engine.prepare()` 之后才第一次读
`mainMixerNode`，而那时 `outputNode` 还没有真值。
