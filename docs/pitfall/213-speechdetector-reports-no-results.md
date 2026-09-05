# 213 iOS 26.6 的 `SpeechDetector` 挂得上、结束得干净，一条结果都不报

## 现象

轮次探针把 `SpeechDetector` 挂进 `SpeechAnalyzer`，`reportResults: true`，跑 71.7 秒一段
「静音 → 手机放音 → 人说三句」的脚本。结果：

```
detectorAttached:    true
reportResults:       true
detectorEvents:      0
detectorStreamEnded: true
```

挂上了、要了结果、序列到点自己正常结束（和转写流同在 71694 ms 结束），中间零条结果。同一次运行里
转写流一切正常：65 条 volatile、6 条定稿，人说的三句一字不差。

不抛错，不警告，没有任何一处说「这个模型没装」或者「这个组合不支持」。

## 原因

不知道。Apple 自己的文档两处互相矛盾：`SpeechDetector.Result` 的摘要说目前只支持 VAD 模型的
**错误处理**，构造器的摘要说它**报告** VAD 模型的结果。实测站在前一句这边。

看不出是「这一版没实现结果流」还是「某个前置条件没满足」——没有任何一条诊断信息可以分开这两者。

## 解法

不等它。VAD 的源用 tap 里自己算的电平，`SpeechDetector` 不接进产品路径
（2026-09-05 定，见 `docs/33` 的「VAD 和轮次检测」）。

轮次状态机吃的是「一个缓冲区一个 dB 数加一个时间戳」（`stepTurnDetect(state, config, db, atMs)`），
换源不动这台机器，所以接缝留着不亏：以后哪一版真报结果了，把事件接到同一个口子上就行。

一般教训：文档自相矛盾的 API，装机结果就是答案，「一条都没有」是答案不是失败。写探针时要把
`detectorAttached` / `reportResults` / `detectorEvents` / `detectorStreamEnded` 四个都记下来——
少任何一个，「零结果」都会被读成「没挂上」或者「跑崩了」。
