# 434 点按翻页的那一帧，替 iOS 补发的合成鼠标事件付账

## 现象

手机分页探针（`scripts/paginate-probe/probe.ts`，一章《尤利西斯》2800 个元素排成 327 列），右侧点按翻页用 CSS transition 平移。真 app 的 WKWebView 里每次点按翻页都有一帧 42-47 ms，拖动翻页同一段平移没有（最长 17-27 ms）。touchend 里 `preventDefault()` 之后，点按翻页最长帧降到 22-26 ms，没有超过 34 ms 的帧。

## 原因

读代码和数推的，没有逐帧剖析：iOS 在没被取消的 tap 之后补发 `mouseover`/`mousemove`/`mousedown`/`mouseup`/`click`，WebKit 为此做命中测试和 `:hover` 的样式失效，落在一棵整章大小的 shadow 树上，正好和 transition 的第一帧挤在同一帧里。拖动在 touchmove 里已经 `preventDefault`，不产生这些事件。

## 解法

阅读区自己处理点按的，在 touchend 里 `preventDefault()`，链接和标注的点按也由自己的命中测试分派，不靠 click。数是模拟器上每组三次点按量的，样本小，真机要复核。
