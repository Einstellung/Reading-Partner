# volatile 结果一毫秒内来六条

## 现象

`SpeechTranscriber` 开了 `.volatileResults` + `.fastResults` 之后，中间结果不是均匀滴下来
的，是成串到达的。同一毫秒的时间戳上连着六条，每条比上一条多几个字符：

```
5493ms  volatile " The"
5493ms  volatile " The trans"
5493ms  volatile " The transfor"
5493ms  volatile " The transformer"
5493ms  volatile " The transformer repl"
5494ms  volatile " The transformer replace"
```

一条 14 秒的语音下来，volatile 事件数是 final 的几十倍。

## 原因

`fastResults` 让识别器一有新假设就发，而它的内部节奏是按解码步走的，不是按时间走的。
一个词解码完会连着吐出几个前缀。

对我们的代价是：每一条 volatile 都是一次 IPC（Swift `trigger` → Channel → 往 webview
里 eval 一段 JS），到了 JS 又是一次 `dispatch` → `setState` → `HoldToTalk` 整棵重渲染，
而这一切发生在一个同时还在跑识别和音频采集的 WKWebView 里。

## 解法

按住说话本来就**不显示实时文字**（docs/15，看着自己的话被改写会把说话变成校对），所以
volatile 的唯一读者是 flush 超时时的兜底文本。既然没人看，就没必要每条都发：Swift 侧
累加器照单全收，往外发的节流到 10Hz。

final 不能节流——它是 webview 真正追加进转写的那一条，丢一条就丢字。

```swift
if result.isFinal {
    lastVolatileAt = 0
    send(["kind": "final", "text": text])
    return
}
guard now - lastVolatileAt >= 0.1 else { return }
lastVolatileAt = now
send(["kind": "volatile", "text": text])
```

顺带记一句实测：一条 final 之后的下一条 volatile 是 `" The"`，不是
`"Attention is all you need. The"`——**volatile 只覆盖未定稿的尾巴，不是累计的整句**。
webview 那边算的是 `finals.join(...) + volatile`，要是累计的就会重复计数，这是这套映射
最容易搞反的一处。
