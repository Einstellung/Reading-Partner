# 199 先停 engine 再 detach，还是 abort

## 现象

坑 198 的解法是「摘 tap → 停 player → 停 engine → 最后 detach」。按这个顺序改完，同一个 abort 在真机上又出现了一次，
栈的上半截一模一样：

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
