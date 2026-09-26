# 438 翻页模式里第一栏之后的页边不属于任何元素

## 现象

手机 EPUB 翻页模式长按划线，手指拖到右页边或最后一行下面，草稿不再跟手，停在手指离开字的前一刻；拖到屏幕右下角，存下来的线比本屏最后一个字少一行。

## 原因

一个 spine 文档排成 CSS 多栏，`.rp-paper` 的盒子只有第一栏那么宽，后面的栏都是溢出。第 k 栏（k > 0）的左右页边、底边、段落之间的空白不在任何元素的盒子里，`elementFromPoint` 落到 strip，`caret.ts` 的 `searchForCaret` 找不到书里的元素，返回 null。iPad 纸页的页边在文档自己的 html/body 里，同样的点能找到最近的字。

## 解法

`flow-marks.ts` 给宿主一个可选的 `strokeCaret`，翻页视图用 `paged-logic.ts` 的 `strokeProbePoints`：把点收进本屏版心，先原高度，再往上、再往下每 8px 探一次，第一个落在字上的 caret 就是划线终点。起划（按下那一点）不走这条，页边按下照旧不起划。
