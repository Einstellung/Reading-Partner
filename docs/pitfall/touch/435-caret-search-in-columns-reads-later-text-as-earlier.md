# 435 多栏里按高度二分找 caret，下一栏的字被当成前面的

## 现象

手机 EPUB 翻页模式，翻页→滚动→翻页往返后晚了一屏（第 57 屏变第 58 屏），顶栏页号不变。量锚点：翻到一屏时取的「本屏第一个字」其实落在第二行，或者落在下一屏；长按划线在跨屏段落里起点也会错位。

## 原因

iOS WKWebView 上 `ShadowRoot` 没有 `caretRangeFromPoint`，`document.caretRangeFromPoint` 在 shadow host 处停下，返回 host 的 DIV，于是 `caret.ts` 走测量兜底：先找最近的文本节点，再对节点里的 caret 盒子二分。二分的「在点之前」原来只比 y（再比 x）。翻页模式一个 spine 文档排成 CSS 多栏，跨屏的段落是同一个文本节点：后一栏顶行的 y 比前一栏底部各行都小。按高度比，顺序不单调，二分落到哪儿看运气，结果可能早也可能晚。取错的字写进 ViewState，滚动模式把它落在顶边，页号还在同一页；回到翻页模式按它落位，就是下一屏。

## 解法

`caret.ts` 的 `nearestOffset`：用 `Range.getClientRects()` 取这个文本节点的行盒，它们按文档顺序排列；每个 caret 盒子按它落在哪个行盒（`lineOf`）排序，同一行再比 x。单栏时和原来一样。测试在 `tests/reading/epub/caret.test.ts`。
