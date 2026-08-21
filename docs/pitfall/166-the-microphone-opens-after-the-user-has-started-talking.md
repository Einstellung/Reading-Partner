# 麦克风在用户已经开口之后才打开，短句丢头字

## 现象

真机手测按住说话 11 次，2 次丢掉第一个字：

```
这是一段中文的输入信息  →  是一段中文的输入信息
今天天气怎么样          →  天天气怎么样
```

同一句话说 2.6 秒时全对，说 2.4 秒时丢头。峰值电平 86-99%，不是音量也不是距离。
看起来像识别质量问题——转出来的句子语法通顺、只是少一个字——所以很容易归到模型头上，
而不是归到采集头上。

## 原因

按下手指到 tap 装上之间根本没有麦克风。`DictationRun.start()` 原来的顺序是先把识别器
整条准备好（权限、locale、模型、`bestAvailableAudioFormat`、`prepareToAnalyze`、
`analyzer.start`）再 `installTap` 加 `engine.start()`，中间每一步都是纯等待。坑 161
留下的那条日志给了这段的长度：

```
RP-DICT firstBuffer +743ms frames=4800 rate=48000
```

用户按下就说话，这 743ms 的音频从来没有被采集过，不是被识别器丢掉的。长句听着正常只是
因为头字落在这个窗口之外。

## 解法

先说一条已经证伪的：**pre-roll 不解决这个坑**。

`start()` 切成两半、中间垫一段 pre-roll 队列（第一半开麦克风，第二半备识别器，交接时把
队列按序补喂进去）确实做了，也确实留着——但它只能救识别器那一半的等待，而识别器那一半
实测只占 80-180ms。真正的一秒在它前面，那时候麦克风还没开，队列缓冲到 0 个 buffer。
iPhone 16 / iOS 26.6 上按住五次，press 到第一个 buffer 稳定在 1028-1255ms：

```
permission                                   +0ms
session（AVAudioSession 配置并激活）          +75ms
voiceProcessing / microphoneFormat            +769ms   ← 约 690ms
capturing（installTap + engine.start）        +950ms
firstBuffer                                   +1063ms
```

那 690ms 是 `setVoiceProcessingEnabled(true)` 重建整个 IO 单元、再读硬件格式。**第 2 到
第 5 次按住和第 1 次一样慢**，说明引擎每次按住都被拆掉重建了。

所以真正要动的是麦克风的生命周期，不是它和识别器的先后。有两条路，互相独立：

- 引擎和 VPIO 建一次留着，按住之间用 `pause()` 而不是 `stop()`——Apple 文档写明
  `stop()` 释放 `prepare()` 分配的资源、`pause()` 不释放。代价是会话不注销，麦克风指示
  灯在两次按住之间是什么状态就是什么状态。
- 不用 VPIO，改 `AVAudioSession.setPrefersEchoCancelledInput(true)`（iOS 18.2+，2024 年
  后的 iPhone），Apple 说它 "does not require explicit voice processing configuration"。
  硬约束：category 必须 `.playAndRecord`、mode 必须 `.default`；`isEchoCancelledInputAvailable`
  查支持，激活之后 `isEchoCancelledInputEnabled` 才是系统真给了没有，路由换成耳机还会
  再变回去。

两条都做成了运行期可切的档位（`plugins/voice/ios/Sources/AudioFront.swift` 的
`AudioProfile`：`current` / `reuse` / `echoCancelledInput` / `reuseEchoCancelledInput`），
一个包能把四档测完，`current` 是上面那组数字的基线。哪一档留下来还没定，等实测数据。

pre-roll 留着，理由变了：`reuse` 档下麦克风在两次按住之间常开，第一半的等待被压掉之后，
剩下的那点交接窗口才是它真正能救的东西。缓冲的是 tap 原格式的原始 buffer，上限 5 秒丢最
旧；模型没装那次是分钟级下载（坑 158），任何上限都救不了，而把几分钟前说的那个字接到
用户后来说的话前面比丢掉更糟。
