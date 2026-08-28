# 198 从还在跑的 engine 上 detach 节点，整个进程 abort

## 现象

真机跑无人值守的语音一轮，app 在第一条腿上没了。`speech-result.json` 停在 `stage: "trimmed-burst"`，
三卷录音一个都没写出来，日志里没有任何错误。看上去像是「腿卡住了」。

崩溃报告（`idevicecrashreport -u <udid> -k ~/crash` 拉下来的 `.ips`）说的是 SIGABRT：

```
exception: EXC_CRASH / SIGABRT      asi: abort() called
thread com.readingpartner.voice.lifecycle
  libc++abi        __cxa_throw
  libobjc.A.dylib  objc_exception_throw
  CoreFoundation   +[NSException raise:format:]
  AVFAudio         AVAudioEngineGraph::RemoveNode(AVAudioNode*, NSError**)
  AVFAudio         -[AVAudioEngine detachNode:]
  Reading Partner  AudioFront.teardownLocked()
  Reading Partner  AudioFront.loseLocked(_:)
  Reading Partner  closure #1 in AudioFront.lose(_:)
```

## 原因

`teardownLocked()` 的顺序是先 `engine.detach(player)` 再 `engine.stop()`。engine 还在跑的时候摘节点，
`AVAudioEngineGraph::RemoveNode` 抛的是 Objective-C 异常，不是往 `NSError**` 里填错误。Swift 接不住 ObjC
异常——没有 `try` 能拦它，`do/catch` 也不行——所以它一路走到 `objc_terminate` 然后 abort。

触发点是 `lose()`：中断通知、`routeChangeNotification`、`didEnterBackground` 三个里的任何一个。也就是说，
播放中途插拔耳机、接上蓝牙、来个电话，都能在正播着音的时候走到这段拆栈代码上。屏幕锁定那条（坑 162）也是。

「detach 要在 stop 之前」原来是有理由的：摘一个还挂着 tap 的节点，等于回调进一个已经不在图里的节点。但那条
只约束 tap 和 detach 的先后，不要求 detach 早于 engine.stop。

## 解法

`AudioFront.teardownLocked()` 里改成：摘 tap → 停 player → 停 engine → 最后 detach。

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

一般化：`AVAudioEngine` 的图操作里，凡是文档说「引擎运行时不允许」的，失败方式都是 ObjC 异常加 abort，不是
可以捕获的 Swift error。运行时状态要自己判，别指望 `try` 兜底。

## 后续

这个解法不够。同样的栈在 engine 已经停了、tap 和 player 也停了的情况下照样抛，`RemoveNode` 的前置条件从外面看不全。最终改成根本不 detach，见坑 199。
