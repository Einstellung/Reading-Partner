# 听写语种选错不是转写变差，是转写变成另一种语言的假话

## 现象

2026-08-17 真人实测，十一次按住说话，其中五次读的是中文。全部按 en-US 识别，因为
`HoldToTalk` 只传 glossary 不传 locale，Swift 侧 `locale=auto` 就去走
`Locale.preferredLanguages`，而这台手机是 en-US。

结果不是「中文识别得不好」：

```
读:  注意力机制取代了循环结构。
出:  2 E D, teacher, Chidalo, Shun.

读:  注意力机制取代了循环结构，模型可以一次读完整句话……（15 秒）
出:  , , , , , , , , , , , , , , ,
```

`teacher` 是「机制」，`Chidalo` 是「取代了」，`Shun` 是「循环」——英文模型在按音节猜英文
单词。十五秒那条更糟：一整句话只剩标点。

## 原因

docs/33 早就写了：**跨语言解码是全有全无，不是逐步变差**。一个 `SpeechTranscriber`
实例只解一种语言，另一种语言根本不在解码空间里。所以送错模型不会得到「带口音的中文」，
会得到一串发音相近的、语法通顺的、完全错误的目标语言词。

危险在于它看起来是正常输出。空转写用户一眼看得出坏了；`2 E D, teacher, Chidalo, Shun.`
看起来像识别器在正常工作，只是这次没听清。

## 解法

不跟随设备语言，做成设置项，默认 zh-CN：`settings.dictationLocale`，
`src/ui/components/settings/DictationLanguageCard.tsx`，一路传到
`nativeDictation({ locale })`。

「跟随设备」在两者一致时才对。这个项目的读者手机是 en-US、跟 AI 说中文，跟随设备就是
每一句中文都变成上面那样。设备语言回答的是「界面用什么语言」，不是「我现在要说什么
语言」。

选项列表是硬编码的 zh-CN / en-US 两项，设备其实支持三十种
（`SpeechTranscriber.supportedLocales`，docs/33）。把真列表拿到 webview 需要给插件加一个
命令，为了加宽一个下拉框不值得；等有别的理由加命令时一起放开。
