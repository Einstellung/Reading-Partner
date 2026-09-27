# 436 多栏里折叠 Range 的矩形按没分栏的位置报

## 现象

手机 EPUB 翻页模式长按划线，状态机走完 start-mark / extend-mark / commit-mark，盘上却没有标注：起点和终点解出的 caret 是同一个偏移（都落在几行之后的 " Therefore"），Range 折叠，`commit` 返回 false。

## 原因

iOS WKWebView 上，CSS 多栏里的文本节点，折叠 Range 的 `getBoundingClientRect()` 给的位置不对应它所在的栏，像是栏没分开时的位置；同一处放一个字符宽的 Range 量出来是对的。`caret.ts` 的测量二分按折叠 Range 的矩形比位置，在多栏里全部比错（iOS 走的就是这条路，见坑 435）。

## 解法

`caret.ts` 的 `caretRect` 不量折叠 Range：边界 i 取字符 i 的一字符 Range 的左边，节点末尾取最后一个字符的右边，零大小的字符往前找。
