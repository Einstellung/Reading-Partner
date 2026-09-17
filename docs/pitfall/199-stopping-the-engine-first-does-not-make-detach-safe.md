# 199 先停 engine 再 detach，还是 abort

## 背景：第一次崩溃，和第一次（不够）的修法

真机跑无人值守的语音一轮，app 在第一条腿上没了。`speech-result.json` 停在 `stage: "trimmed-burst"`，三卷录音一个都没写出来，日志里没有任何错误，看上去像是「腿卡住了」。崩溃报告（`idevicecrashreport -u <udid> -k ~/crash` 拉下来的 `.ips`）说的是 SIGABRT，栈顶是 `AVAudioEngineGraph::RemoveNode`：`teardownLocked()` 当时的顺序是先 `engine.detach(player)` 再 `engine.stop()`，engine 还在跑的时候摘节点，`RemoveNode` 抛的是 Objective-C 异常，不是往 `NSError**` 里填错误，Swift 接不住，一路走到 `objc_terminate` abort。触发点是 `lose()`：中断通知、`routeChangeNotification`、`didEnterBackground` 三个里的任何一个都能在正播着音的时候走到这段拆栈代码；屏幕锁定那条（坑 162）也是。

第一次的修法是把顺序改成「摘 tap → 停 player → 停 engine → 最后 detach」：

```swift
player?.removeTap(onBus: 0)
player?.stop()
if engine.isRunning {
    engine.stop()
}
if let player = player {
    engine.detach(player)
}
```

这条不够：`RemoveNode` 的前置条件从外面看不全，不是只看 engine 跑没跑，顺序排对只是让它少抛一点，不是让它不抛，见下文。一般化的教训是：`AVAudioEngine` 的图操作里，凡是文档说「引擎运行时不允许」的，失败方式都是 ObjC 异常加 abort，不是可以捕获的 Swift error，运行时状态要自己判，别指望 `try` 兜底。

## 现象

按上面这个顺序改完，同一个 abort 在真机上又出现了一次，栈的上半截一模一样：

```
exception: EXC_CRASH / SIGABRT     Abort trap: 6
thread com.apple.root.default-qos.cooperative
  libc++abi        __cxa_throw
  libobjc.A.dylib  objc_exception_throw
  CoreFoundation   +[NSException raise:format:]
  AVFAudio         AVAudioEngineGraph::RemoveNode(AVAudioNode*, NSError**)
  AVFAudio         -[AVAudioNode didDetachFromEngine:error:]
  AVFAudio         -[AVAudioEngine detachNode:]
  Reading Partner  AudioFront.teardownLocked()
  Reading Partner  AudioFront.close()
  Reading Partner  static SpeechProbe.setVoiceProcessing(_:)
```

这一次 `engine.isRunning` 已经是 false，`player.stop()` 和 `removeTap` 都做过了。触发点也换了：不是路由变化，是
主动 `close()`——探针切 VPIO 那一下。

## 原因

`RemoveNode` 抛不抛异常，不是只看 engine 跑没跑。它对图的状态有一整套自己的前置条件，从外面看不全，而它报错的方式
是 ObjC 异常而不是往 `NSError**` 里填——Swift 接不住，直接 abort。把顺序排对只是让它少抛一点，不是让它不抛。

## 解法

**不要 detach。** 拆栈时摘 tap、停 player、停 engine，然后就把 `engine` 引用置空，让整张图跟着 engine 一起释放。
一个不会比 engine 活得更久的节点，不需要从一张马上就不存在的图里摘出来。

同一条也适用于临时搭起来的 engine（比如探针里量路由用的那个）：用完 `removeTap` + `stop` 就够，不要 detach。

## 真机实测

2026-08-29 的一轮验过：同一处（探针切 VPIO 时的 `close()`）拆栈走完，`RP-DICT front closed` 打了出来，没有
abort。这一条结案。同一轮崩在它后面 1.3 秒的另一件事上，和 detach 无关，见坑 201。
