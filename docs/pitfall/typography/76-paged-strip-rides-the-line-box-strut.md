# 翻页模式的页带挂在一个行盒上，改全局 line-height 就把整页挪了一像素

## 现象

引入 preflight（它给 `html` 加了 `line-height: 1.5`，此前是浏览器默认的 `normal`）之后，竖排连续滚动的阅读区截图逐字节相同，翻页模式的截图差了 11 字节：页面上移 1px，滚动容器的 `scrollHeight` 从 905 变成 906（视口 900）。缩放、页尺寸、标注层坐标全都没变。

## 原因

翻页模式下 EmbedPDF 的页带是滚动容器里的一个 `display: inline-block`。行内级盒子要落在行盒里，行盒的高度是它和**行盒 strut**（由容器的 `font-size` + `line-height` 生成的看不见的基线框）取并集；inline-block 的基线是它的下外边缘，strut 的下伸部分就垫在它下面。`line-height` 从 `normal`（这套字体约 1.15）变成 1.5，半行距变了，页带在行盒里的位置和行盒总高跟着变。

竖排模式不受影响：那条路上没有行内级盒子，页是绝对定位的。

同一次改动还顺手消掉了另一个相关产物：页面光栅是 `<img>`，preflight 之前是 `display: inline`，它自己也起一个行盒，于是每个页容器都有 5px 的幽灵 `scrollHeight` 溢出；preflight 的 `img { display: block }` 让这 5px 归零。

## 解法

不管。1px，且翻页模式本来就有 5–6px 的竖向余量。

要管的话，唯一干净的做法是给滚动容器 `line-height: 0`——但那是引擎的元素，宿主只能整棵 `[data-reader-surface]` 下手，而选中菜单槽和触摸调试层的文字都在这棵子树里，代价大于收益。

真正的用处是知道这条链存在：**阅读区的竖向落点会被继承来的 `line-height` 拉动**。以后再动全局排版（换字体、改 `line-height`、上 shadcn 的 base），翻页模式要单独复测，不能只看竖排。复测方法是逐状态截图按字节比对（`fit` / 两级 `zoomIn` / `fitWidth` / 跳页 / 选中标注 / `paged`），差异只会出现在真正动了的那一格。
