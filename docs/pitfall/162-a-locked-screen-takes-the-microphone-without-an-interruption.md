# 锁屏把麦克风拿走了，但一条 interruption 通知都没有

## 现象

按住说话的过程中屏幕自动锁了。日志里只有一行路由变化：

```
RP-DICT route in=[MicrophoneBuiltIn] out=[Speaker]
RP-DICT route in=[] out=[Speaker]
```

`AVAudioSession.interruptionNotification` 一次都没来，`.began` 没有，`.ended` 也没有。
引擎的 `isRunning` 还是 true，tap 还装着，只是再也没有一个 buffer 进来。webview 的
定时器同时被挂起，所以那一轮的 `stop_dictation` 也发不出去——整个流程停在原地，
没有任何一方报错。

## 原因

锁屏是把 app 切到后台，不是打断音频会话。输入路由被系统收走，会话本身没有被别人抢，
所以不满足 interruption 的定义。docs/33 记的"任何 interruption 都是会话死亡"处理不到
这一种，因为它根本不是 interruption。

## 解法

产品里其实碰不到：真手指按在屏幕上会一直重置 idle timer，按住说话的整个过程屏幕不会
自动锁。**是合成的 pointer 事件碰得到**——它不重置 idle timer，所以无人值守的真机脚本
跑过两分钟就会撞上这个。

脚本侧：`navigator.wakeLock.request("screen")`（Safari 16.4+ 有，但实测在 Tauri 的
`tauri://` 页面里被拒：`Permission was denied`，多半是缺 user activation），或者把整段
脚本压进一个自动锁定周期内，或者让人把自动锁定设成"永不"。

代码侧：不要指望 interruption 通知能覆盖"麦克风没了"。真要检测，判据是"装了 tap 之后
一段时间内一个 buffer 都没有"——探针的 input watchdog 就是干这个的，promote 的时候
砍掉了；如果以后要做后台/录长音，它得回来。
