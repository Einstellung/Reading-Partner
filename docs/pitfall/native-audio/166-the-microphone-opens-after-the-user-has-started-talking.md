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

改完之后再测五次，三次还是丢头：`今天天气怎么样` 出来一次 `天气怎么样`（丢两个字）、
一次 `天天气怎么样`（丢一个字）。

## 原因

按下手指到 tap 装上之间根本没有麦克风。press 到第一个 buffer 实测 1028–1255ms，五次
高度一致，这段音频从来没有被采集过，不是被识别器丢掉的。长句听着正常只是因为头字落在
这个窗口之外。

同一次按住的分段（`RP-DICT` 的 `mark` 日志）：

```
permission                                      +0ms
AVAudioSession 配置并激活                        +75ms
setVoiceProcessingEnabled(true) 之后读到硬件格式   +769ms
installTap + engine.start() → capturing          +950ms
第一个 buffer                                    +1063ms
```

约 690ms 花在 `setVoiceProcessingEnabled(true)`——它重建 IO 单元（坑 133）。识别器那
一半（locale、模型、`bestAvailableAudioFormat`、`prepareToAnalyze`、`analyzer.start`）
只占 80–180ms。第 2 到第 5 次按住和第 1 次一样慢，引擎每次按住都被拆掉重建。

## 重排 start() 收益为零

`start()` 切成两半，中间垫一段 pre-roll。第一半只做打开麦克风需要的事（权限、session、
VPIO、tap、`engine.start()`），第二半才是识别器。两半之间 tap 已经在跑，音频进一个队列；
`analyzer.start()` 之后按顺序补喂进去，喂空了再切实时流——交接在锁里翻标志位，队列空了
才翻，所以既不重叠也不留洞。缓冲的是 tap 原格式的原始拷贝（转换器的目标格式来自
`bestAvailableAudioFormat`，那一问排在模型安装后面），上限 5 秒丢最旧。

代码还在，方向也对，但量出来没救回任何东西：五次按住里四次 pre-roll 缓冲到 0 个 buffer，
唯一一次是 2 个 buffer / 200ms。瓶颈在打开音频通道那一段，识别器那一半本来就短，垫在中间
的队列没有东西可垫。头损失原封不动，就是 press 到第一个 buffer 那一整秒，
`RP-DICT firstBuffer` 量的正是它。

## 解法：留着引擎不拆

2026-08-22，同一台 iPhone 16、iOS 26.6，28 次真机按住：

```
                  n   按下→首个 buffer 中位数   范围         转写完整
留着引擎           9        304ms             120-316      9/9
每次重建          13       1082ms             490-1277     2/13
```

丢头字就此消失。做法是把音频前端（session + VPIO + engine + tap）的持有者从一次按住
改成一次语音模式：第一次按住建，之后按住之间 `engine.pause()` 而不是 `stop()`
（`stop()` 会释放 `prepare()` 分配的资源），切回键盘 / 离开聊天 / 组件卸载才真拆。
完整形态和 iOS 收走麦克风怎么处理在 docs/15 和 `plugins/voice/README.md`，那两个数在 docs/33「实测」。

第一次按住仍然付那一秒，仍可能丢头字，接受——预热必然点亮橙点（坑 167），代价是用户
还没开口就亮。

`setPrefersEchoCancelledInput` 那条不用了。同一轮里开 VPIO 复用 305ms、关 VPIO 复用
277ms，分不出差别（VPIO 那几百毫秒只在第一次付），而且 `isEchoCancelledInputAvailable`
在这台 iPhone 16 上是 false，根本拿不到。代码已删。

## pre-roll 现在有用了

上面那段「重排 start() 收益为零」记的是原因，不是判决。冷启动时 pre-roll 缓冲到 0 个
buffer，因为那一秒里麦克风还没开，队列里没有东西可垫；复用形态下麦克风一直开着，按下
那一刻 tap 已经在跑，缓冲里真有音频。所以它现在管的是识别器那一半的 80–180ms——
locale、模型、`bestAvailableAudioFormat`、`prepareToAnalyze`——那段时间的音频进队列，
`analyzer.start()` 之后按序补喂。代码没动，位置没变，只是终于有东西给它接。
