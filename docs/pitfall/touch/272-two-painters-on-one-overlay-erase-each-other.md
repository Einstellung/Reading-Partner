# 引文高亮一出现，这一页的标注全没了

## 现象

AI 引用一段话，`highlightQuote` 把紫条画上去，同一页上的高亮和墨迹同时消失。反过来也一样：标注一重画，引文高亮没了。清引文（`clearQuoteHighlight`）之后标注也不会自己回来，要滚出去再滚回来重新挂卡片才有。

## 原因

页卡片只有一层 `.rp-overlay`，引文和标注两个画笔都往里画，两边各自用 `replaceChildren()` 清场——清的是整层，包括对方画的。这不是竞态，是两个模块共用一块画布又都以为自己独占。

## 解法

一层 overlay 里开两个子层，各清各的：标注画进 `.rp-marks`，引文画进 `.rp-quote`，都是 `position:absolute; inset:0; pointer-events:none`，按需要创建（卡片换文档时 overlay 会重建，子层跟着没）。`replaceChildren()` 只对自己那层调。

再加一个画笔就再开一层；判据是「谁清场」，不是「谁画得多」。
