# 675 Range 的 client rects 对完整包住的块级元素给整块盒

## 现象

EPUB 上从一段中间拖到隔一段的中间，选区的蓝色、存下的高亮都画成一块实心方块，下划线只剩方块底部一条。WebKitGTK 实测（`scripts/epub-marks-probe/run.sh`）：滚动排法正文 7 行只画出 4 条，其中一块 400x112（行高 26）；多栏排法得到 407x56 和 407x75。选区只要完整包住一个段落、标题、li、blockquote 就会这样，只在一段之内划不会。

## 原因

`Range.getClientRects()` 对范围完整包住的元素返回它自己的边框盒，再返回里面文字的盒。坑 444 里那是行内 `<em>`，盒子和文字几乎重合；块级 `<p>` 的盒是整段高、整栏宽。`lineBands` 把竖向重叠超过较矮者一半的盒并成一条，每行文字都和这个大盒重叠一半以上，于是整段所有行和它并成一个矩形。

## 解法

不直接用 range 的 client rects，改用 `mark-draw.ts` 的 `textRectsOf(range)`：沿 TreeWalker(SHOW_TEXT) 只取和 range 相交的文本节点，每个节点建子 Range（首尾按 range 的 offset 截）分别量。流式视图的 `rectsIn`、`selection()`，页卡片的 `rectsOf` 都走它；`reader-view.ts` 判引文可见和 `mark-layer.ts` 的 `reveal` 也因此只看文字（坑 271、283 的判据不变）。坑 444 的重复随之消失，`lineBands` 留着合并同一行上分属几个文本节点的盒。完整包在选区里的图片不再被涂色。
