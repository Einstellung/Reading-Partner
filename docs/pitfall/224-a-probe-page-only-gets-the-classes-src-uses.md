# 224 探针页只拿得到 src 里出现过的 utility class

## 现象

无头截图用的静态探针页里，自己写的布局 class 一部分静默失效。核对配色时用 `grid grid-cols-4 gap-4` 摆了两张 `BookCard`，出来的图是一张撑满整行的灰方块，进度条被挤到画面外，看上去像卡片组件排版坏了。改用组件自己的 `LIBRARY_GRID` 常量之后一切正常，组件从头到尾没问题。

## 原因

Tailwind v4 只生成它在扫描目标里见过的 class。这个仓库扫的是 `src/`，探针页在 `src/` 之外，`dist/assets/index-*.css` 里就没有 `grid-cols-4` 这条规则。浏览器拿到一个不存在的 class 不报错，`display:grid` 生效、列数没设，于是变成一列。缺的是布局 class 时最难看出来，因为页面还是"排出来了"。

## 解法

探针页只用两种 class：组件自己带的，和从组件文件里导出的常量（`LIBRARY_GRID`、`TOPIC_GRID_COLUMNS_CLASS` 这些）。要自己搭壳就用 inline `style`，别现写 utility class。写完先在图里找一处只可能来自那条 class 的效果，确认它真的生效。
