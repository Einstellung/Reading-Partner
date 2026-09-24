# iPhone 上不带 `playsinline` 的 video 一播就全屏，app 已经开了 inline 播放也一样

## 现象

iPhone 17 模拟器（iOS 26.5），一个按 wry 0.55 的方式配置的裸 WKWebView：`allowsInlineMediaPlayback` 为 YES，`mediaTypesRequiringUserActionForPlayback` 为空（不要手势就能出声自动播）。同一张 EPUB 纸页上几个 blob 源的 `<video>`，无手势调 `play()`：

| video | `play()` | 1.5 s 后 | `webkitDisplayingFullscreen` |
|---|---|---|---|
| 带 `playsinline` | resolve | `currentTime` 1.44，在纸页里播 | false |
| 不带 `playsinline` | resolve | `currentTime` 1.45 | true，原生全屏播放器盖住整个 app |

另外两件同一轮量到的：

- 两个带 `playsinline` 的 video 先后 `play()`，后一个开始播时前一个被暂停（`paused` true、`currentTime` 0）。iPhone 上一页只有一个出声的媒体在播。
- 没播过的 video 不画首帧：`readyState` 4、`videoWidth` 320，纸页上仍是一块白底加一个播放钮。

## 原因

`allowsInlineMediaPlayback` 只是允许 inline，iPhone 上 WebKit 还要元素自己带 `playsinline` 才 inline 播，缺了就按老规矩进全屏。iPad 不受这条约束。首帧不画、同时只放一个出声媒体是 iOS 的媒体会话策略，和 app 配置无关。

## 解法

放开 `<video>` 时，消毒器保留 `playsinline`，合订本构建时给每个 `<video>` 补上，不指望来源页带。要有首帧就在构建时给 `poster`（一张打进包里的图）。多个媒体互相暂停不用处理，这正是想要的。

量法：一个几十行 Swift 的裸 WKWebView 模拟器 app（`xcrun -sdk iphonesimulator swiftc -parse-as-library`，`codesign -s -`，`simctl install/launch … -url <页面>`），配置照抄 `wry/src/wkwebview/mod.rs`；页面挂的是真的 `sanitize` + `mountDocument`，读数经 POST 回 Mac 上的 http 服务。模拟器 Safari 不等价：它的 inline 与自动播放默认值和 app 的 WKWebView 不同。
