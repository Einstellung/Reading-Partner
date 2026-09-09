# EPUB 上拖选区，六个 pointermove 之后就被滚动抢走

## 现象

iPad 模拟器，滚动模式，打开「用手指画」选高亮笔：横着拖能落标注，只要带一点
竖向位移就落不下。量到的事件是 `pointerdown` → 6 个 `pointermove` →
`pointercancel`，没有 `pointerup`，容器滚了几百 px。斜拖和竖拖都一样，也就是
所有跨行的选区。

## 原因

坑 117 那件事在这里换了个场地：书的 iframe 透明之后，触摸落在 foliate 的
`#container` 上，那是个 `overflow-y: auto` 的滚动容器，WebKit 走几个 move 就把
序列收走给自己滚。`pointermove` 上 `preventDefault()` 没用——能拦下滚动的只有
`touchmove`。EPUB 这侧又不能照 PDF 那样全局 `touch-action: none`：滚动模式的
翻页就是这个容器在滚。

## 解法

pane 上手工挂一个 `{passive:false}` 的 `touchmove`，`claimsTouch(layout,
drawing)` 说了算：正在拖选区就抢（两种布局都抢，那是在落标注不是在滚），翻页
模式下一律抢（那条流下面没有东西可滚，滑动半路被 cancel 就一页都不翻）。
React 自己的 `onTouchMove` 是 passive 的，`preventDefault()` 在里面无效。

抢的时机只能是第一个 `touchmove`：`beginDraw` 在 `pointerdown` 里做完，
`drawingRef` 那时就已经有值。改完实测斜拖 81 个 move 一路到 `pointerup`，
`scrollTop` 一动不动，标注落下。
