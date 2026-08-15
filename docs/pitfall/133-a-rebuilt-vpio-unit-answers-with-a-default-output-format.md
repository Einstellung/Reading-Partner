# VPIO 重建 IO 单元之后、`prepare()` 之前，输出侧报的是 44.1kHz 立体声默认值

## 现象

会话跑在 48000Hz，`outputNode.inputFormat(forBus: 0)` 和 `mainMixerNode` 的输出格式都报 44100Hz 2ch。按这个值把播放节点接进主混音器，整条输出链和硬件对不上，引擎起不来——表现就是坑 132：`start()` 不报错，`isRunning` 是 false，tap 一个回调都没有。

## 原因

`setVoiceProcessingEnabled(true)` 会重建 IO 单元。重建之后到 `engine.prepare()` 之前，输出侧对硬件的回答是 AVAudioEngine 的默认值，不是真实硬件格式。而 `engine.mainMixerNode` 这个属性第一次被读到就会创建主混音器，并由引擎把它连到输出节点——这一下如果发生在 `prepare()` 之前，整条输出链就按那个 44.1k 默认值定死了。

## 解法

`engine.prepare()` 排在第一次访问 `engine.mainMixerNode` 之前。也不要拿 `outputNode.inputFormat(forBus:)` 去"纠正"格式，那读到的正是那条错误连接自己；硬件格式读 `outputNode.outputFormat(forBus:)`。

纯采集路径不受影响：不接播放节点、从不碰 `mainMixerNode` 就没有那条输出链，所以加播放之前一直是好的。
