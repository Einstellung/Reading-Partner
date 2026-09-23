# `AVAudioEngine.start()` 不抛异常，引擎却没在跑

## 现象

`engine.start()` 正常返回，没有 throw。随后 `engine.isRunning` 是 false，装在输入节点上的 tap 一个回调都不触发，采集全程静默，也没有任何报错。上层看到的是"启动成功、状态机准时推进到 running、零个音频缓冲"这种看着健康的组合，跑满 45 秒导出之后才发现一条转写都没有。

## 原因

引擎的图和硬件格式对不上时，引擎在启动的路上被拆掉，而 `start()` 本身不报错。这一轮的具体成因是坑 133。

## 解法

`start()` 之后自己断言：

```swift
try engine.start()
guard engine.isRunning else {
    throw ProbeError(
        "the engine reported no error but is not running: output accepts "
        + describe(engine.outputNode.inputFormat(forBus: 0)) + " while its hardware is "
        + describe(engine.outputNode.outputFormat(forBus: 0))
        + " and the session runs at \(session.sampleRate)Hz")
}
```

输出链接受的格式、输出节点的硬件格式、会话的 `sampleRate`，这三个数就是诊断本身：对不上的那一对当场看得见。
