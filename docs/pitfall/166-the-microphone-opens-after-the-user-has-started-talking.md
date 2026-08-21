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

`start()` 切成两半，中间垫一段 pre-roll。第一半只做打开麦克风需要的事（权限、session、
VPIO、tap、`engine.start()`），第二半才是识别器。两半之间 tap 已经在跑，音频进一个队列；
`analyzer.start()` 之后按顺序补喂进去，喂空了再切实时流——交接在锁里翻标志位，队列空了
才翻，所以既不重叠也不留洞。

缓冲的是 tap 原格式的原始 buffer，不是转换过的：转换器的目标格式来自
`bestAvailableAudioFormat`，那一问排在模型安装后面，而模型安装正是最长的一步。tap 交出来
的 buffer 归 audio unit 所有、回调一返回就被复用，留下来必须逐个拷贝。

上限 5 秒，超了丢最旧的。模型没装那次是分钟级的下载（坑 158），任何上限都救不了那一次，
而把几分钟前说的那个字接到用户后来说的话前面比丢掉更糟。

## 这个解法收益为零

改完上真机，五次按住里四次 pre-roll 缓冲到 **0 个 buffer**，只有一次缓到 2 个 buffer /
200ms。丢头字原样存在：四次中文里三次丢，"今天天气怎么样"转出"天气怎么样"（丢两个字）和
"天天气怎么样"（丢一个字）。

分段耗时说明了为什么。同一次按住，五次高度一致：

```
permission                                     +0ms
AVAudioSession 配置并激活                       +75ms
setVoiceProcessingEnabled(true) 之后读到硬件格式  +769ms
installTap + engine.start() → capturing        +950ms
第一个 buffer                                  +1063ms
```

press 到第一个 buffer 是 1028-1255ms，识别器那一半（locale、模型、
`bestAvailableAudioFormat`、`prepareToAnalyze`、`analyzer.start`）只占 80-180ms。重排
两半确实让识别器不再挡在麦克风前面，但它挡住的本来就只有一百毫秒；那一秒在打开音频通道
这一段里，其中约 690ms 是 `setVoiceProcessingEnabled(true)` 重建 IO 单元。pre-roll 缓不到
东西，因为那时候麦克风还没开。

第 2 到第 5 次按住和第 1 次一样慢，说明引擎每次按住都被拆掉重建，这 690ms 每次都付。

真正的头损失是 press 到第一个 buffer 的整整一秒，`RP-DICT firstBuffer` 量的正是它。
pre-roll 留着：它要等麦克风常开之后才有用武之地。

候选解法，都**还没验证**：引擎和 VPIO 建一次就留着，按住之间用 `pause()` 而不是 `stop()`
（`stop()` 会释放 `prepare()` 分配的资源，`pause()` 不会）；或者改用
`AVAudioSession.setPrefersEchoCancelledInput()` 绕开 VPIO 拿回声消除，它要求 category
`.playAndRecord` 且 mode `.default`，只在 2024 年之后的 iPhone 上可用。两条都要实测，
第二条的激活开销没有任何公开数字。
