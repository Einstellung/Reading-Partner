# 停在那儿不撤的探针，把它旁边那次测量污染掉了

## 现象

一轮 21 次按住，四个音频档各测五次，数据完整、格式正常、每行都有 `timing.steps`。
读出来的结论是「音频会话激活要 850ms」——和之前几轮对不上，但看不出哪里不对。

把 `session` 这一步单独拉出来排序，才发现它是双峰的：

```
72  115  133  134  137  156  ...   （11 次）
584 607  822  825  850  872  877  895  900  914  940  977   （9 次）
```

中间没有任何值。同一台机器、同一个 build、同一个人在同一分钟里按的，一半 72-156ms，
一半 584-977ms。

对上的是橙点探针停在哪一档：探针停在 `off` 或 `session`，下一次按住就是快的那组，
11 次全中；停在 `engine` / `tap` / `recording`，下一次就是慢的那组，9 次全中。

同一轮里还有第二个损失：`reuse` 和 `reuseEchoCancelledInput` 两档一共十次按住，
`timing.reused` 全是 false。引擎复用是这轮要测的主要杠杆，一次都没被走到，
而文件里没有任何一个字段说得出为什么。

## 原因

探针的四档里有三档会建一个 `AVAudioEngine` 并打开 VPIO，而且停在那儿不撤——
这正是它的用途，人要拿着手机看状态栏。

下一次按住走到 `AudioFront.open()`，看见探针还占着麦克风，就"帮忙"把它拆掉再开自己的：

```swift
if stage != .off {
    teardownLocked()   // 拆引擎、停会话
}
```

拆的账记在了这次按住头上。`teardownLocked()` 里的 `setActive(false)` 加引擎 stop 要花
四百到八百毫秒，而计时的零点是手指落下那一刻，所以这笔钱全落在 `session` 这一步上——
一个和会话激活毫无关系的开销，长在了名字叫「会话激活」的那一格里。

`reused` 全 false 是同一件事的第二个后果：`teardownLocked()` 顺手把上一次按住留着的引擎
也清了（`engine = nil`、`openProfile = nil`），于是复用路径的 guard 每次都落空，
每次都重建。档位选了，底下没走。

这不是实现写错了，是测量台的设计让一整轮数据静默作废：日志正常，行数正常，字段齐全，
数字本身也是真的——只是它测的不是听写路径，是"拆一个引擎再建一个引擎"。
和坑 165 是近亲：那个是探针的持久化扛不住它要观测的失败，这个是探针的状态改变了它要观测的对象。

## 解法

别帮它复位，直接拒绝。但判据不是"探针现在停在哪一档"——那条第一次就写错了：

```swift
// 错的
if stage != .off { throw ... "先把探针关掉" }
```

因为 `setIndicatorProbe(.off)` 自己也 `teardownLocked()`。人看到"先把探针关掉"、
点了 `off`、再按住，这时 `stage == .off`，放行——可要复用的引擎在点 `off` 的那一瞬间
就已经没了。数据照样静默作废，而且这一版还是提示语亲手指挥人去毁的。

判据是"从上一次按住到现在，探针被碰过没有"，`off` 也算碰过：

```swift
if probeTouchedSinceHold {
    teardownLocked()               // 栈退回空，代价记在这次被拒的按住头上
    probeTouchedSinceHold = false  // 只赔一次按住
    throw DictationError(
        "The indicator probe has had the microphone since the last hold, so this one "
            + "was refused and the audio stack put back to nothing. The holds before it "
            + "are not a run any more — start the profile over from the next hold.")
}
```

拆除动作放在被拒的那次按住里，而不是放在下一次被服务的按住里——这是整件事的分界：
被拒的那次按住的数不算数，所以它出多少钱都无所谓；被服务的那次出了钱，账就记在
`session` 那一格上，行看起来完全正常。碰一次探针固定赔一次按住，下一次就是干净的冷启动。

界面上不能写"先把探针关掉"，那正是会毁掉引擎的动作。要写的是这一轮结束了：探针和按住测量
互斥，碰过就得重来一轮。同时把探针那排按钮折进一个开关后面——它原来是五个整宽按钮平铺在
拇指上方，误触一下就毁一轮。

配套两条，缺一条就还是会静默：

- 拒绝掉的那次按住照样落一行，带上两个字段：`probeStage`（`never` / `off` / 某一档）和
  `probeTouched`。判"这次被拒了"只能看后者，前者是给人读的上下文。
- 拒绝之后 `release()` 不用再特殊照顾——被拒那次已经把栈退回空了，`stage` 一定是 `off`。

没走成的快路径要说出理由。`reused: false` 旁边加一个 `reuseSkipped`，
写清是"没东西可复用"、"格式变了"、还是"留下的引擎起不来"。
一个孤零零的 false 分不出"复用没用"和"复用没跑"，而这两件事的结论正好相反。

顺带两条埋点：

- 复用路径上的 `session` / `voiceProcessing` / `microphoneFormat` 挪到 `engine.start()` 前面。
  会话本来就没断、IO 单元本来就没重建，这三步是继承来的不是花钱买的；挪完之后
  "重启一个 paused 引擎要多久"就单独露在 `capturing` 减 `microphoneFormat` 上。
- `AVAudioEngine()` 加第一次读 `inputNode` 单独埋一格。第一次读 `inputNode` 会实例化输入
  audio unit 并问硬件，跳过 VPIO 的两档的钱全在那儿，混在 `voiceProcessing` 那一格里
  同一个 profile 能差 27 倍（14ms 和 372ms）。

## 还没堵上的

换音频档是同一个形状的小一号版本：从 `reuse` 切到别的档，切完第一次按住得先拆掉上一档
留着的引擎，账同样落在它的 `session` 上。没上"赔一次按住"那套，因为它认得出来——文件里
每次切档都有一行 `profile`，紧跟着的第一次按住就是那一次，按每档五次算二十次里有两次。
下一轮要是发现这两次也碍事，照 `probeTouchedSinceHold` 的做法再来一遍就行。
