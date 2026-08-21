# 另一个实例占着麦克风时，`finalizeAndFinishThroughEndOfInput()` 挂了 89 秒

## 现象

健康会话上 `try await analyzer.finalizeAndFinishThroughEndOfInput()` 是 70-330ms 返回
（实测十几轮，中位数约 100ms）。有一次它跑了 **89483ms** 才回来，紧接着的
`setActive(false)` 又花了 1854ms，一次 `stop_dictation` 总共 91 秒。

同一时刻设备上有两个 app 实例：`xcrun devicectl device install app` 装新包不会杀掉正在
跑的旧进程，旧的那个还在后台端着 `AVAudioSession`。新实例的 `configureSession()` 直接
抛错，日志里那一轮只有 `permission` / `locale` / `model` 三行，然后就是
`finalized +0ms`——引擎根本没起来。

## 原因

两个实例抢同一个 `.playAndRecord` + `.voiceChat` 会话。输给对方的那个 analyzer 在等一个
永远不会走完的输入流，`finalize` 就一直不返回。

真正致命的不是这 89 秒本身，而是三个命令跑在同一条串行链上（一次只允许一个 run，
否则两个引擎抢会话）。链头挂住，后面每一次按住说话都排在它后面。webview 那边 2.5 秒就
放弃 flush 并允许用户再按一次，用户按了，那一次直接进队列干等。

## 解法

两件事都要做。

**给 finalize 设上限。** 2 秒到了就带着已经攒下的文字返回，别再等：

```swift
let finalized = Gate()
Task {
    try? await analyzer.finalizeAndFinishThroughEndOfInput()
    finalized.signal()
}
await finalized.wait(upToMs: 2000)
```

Swift 没有办法放弃一个"等另一个 Task 结束"的 await——取消等待方不会让它返回，
`withTaskGroup` 退出时还要等所有子任务。所以用一个一次性闩：超时的定时器去 signal
同一个闩，谁先到谁把所有等待方叫醒。`plugins/voice/ios/Sources/DictationRun.swift` 的
`Gate` 就是这个。

**装包之前先杀旧进程。** `devicectl device install app` 不停止运行中的实例：

```
for pid in $(xcrun devicectl device info processes --device $UDID | grep "Your.app" | awk '{print $1}'); do
  xcrun devicectl device process signal --device $UDID --pid "$pid" --signal SIGKILL
done
```
