# 201 留着上一张图的 player 节点，`play()` 直接 abort

## 现象

真机跑到切 VPIO 那一步，进程 SIGABRT。栈在 `com.readingpartner.voice.speech` 线程上：

```
CoreFoundation   +[NSException raise:format:]
AVFAudio         AVAudioPlayerNodeImpl::StartImpl(AVAudioTime*)
AVFAudio         -[AVAudioPlayerNode play]
Reading Partner  closure #1 in SpeechOut.enqueue(...)
Reading Partner  specialized closure #2 in static SpeechProbe.start(_:)
```

崩溃报告里没有原因那句，syslog 里有：

```
Terminating app due to uncaught exception 'com.apple.coreaudio.avfaudio',
reason: 'player started when in a disconnected state'
```

前后一秒的日志是完整的一串：

```
11:31:04.631  RP-DICT front closed        拆栈走完了，没 abort
11:31:05.669  RP-DICT session +78ms       又开了一副新的
11:31:05.902  RP-DICT front built player=yes
11:31:05.920  *** Terminating app ... 'player started when in a disconnected state'
```

## 原因

`SpeechOut` 把 player 节点缓存下来，省掉一句话一次重建。而 `AudioFront.teardownLocked()` 把自己那份
`engine` / `player` 置空之后，**没有办法同步告诉缓存方**：拆栈是握着 `lock` 跑的，通知只能
`DispatchQueue.global().async` 派出去。于是拆栈和通知之间有一个窗口，实测 1.3 秒。

窗口里正好新开一副 front，`enqueue` 就会拿到两半不属于同一张图的东西：player 是上一张图的（缓存），engine 是新
那张的（现问的），两个 guard 都过——engine 非空、engine 在跑——然后 `play()` 打在一个不在当前图里的节点上。
`AVAudioPlayerNode` 对此抛 ObjC 异常，Swift 接不住，abort。

这条不是探针独有的：任何一次拆栈（路由变化、中断、进后台）之后紧跟着来一句要播的话，走的都是这条路。以前走不到，
是因为坑 199 那个 abort 排在更前面——拆栈自己先崩了。修掉前面那个，后面这个才露出来。

## 解法

取用侧问一句这个指针还算不算数，而不是等那条异步通知：

```swift
// AudioFront
func isCurrentSpeaker(_ node: AVAudioPlayerNode) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return engine != nil && player === node
}

// SpeechOut
if let player = player, AudioFront.shared.isCurrentSpeaker(player) { return player }
player = nil
```

**还剩一个微秒级窗口，是故意留的**：问完到 `play()` 之间锁又放开了，这几微秒里拆栈仍然能撞上。没观察到过，也不为它
加东西——把锁一直 held 到 `play()` 会换来一类必然发生的死锁，AVFAudio 在 `play()` 里会回调进来。

一般教训：**缓存一个别处持有的对象指针，就得有办法问它还算不算数。** 持有方拆自己那半的时候握着锁，它能给的通知
一定是异步的，也就一定有窗口；靠通知清缓存等于假设那个窗口不存在。

## 补记（2026-08-29）

上面那段日志里的 abort 不是这条坑造成的，是坑 203：那条腿关掉了 VPIO，输出链没绑上硬件。这条描述的窗口
真实存在，`isCurrentSpeaker` 也确实关掉了它，但它从来没被观测到触发过——同一处 abort 换了守卫之后一字未变，
四轮全在原地。缓存别处持有的指针要能问它还算不算数，这条一般教训仍然成立。
