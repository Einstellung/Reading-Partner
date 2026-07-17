# EmbedPDF "当前页"的可见区 origin 常常是 0，页内位置会丢

现象：存阅读位置时取 `getCurrentPage()` 对应的 `pageVisibilityMetrics` 项、用它的 `original.pageY` 做页内偏移，结果经常存下 0：重开后落在该页页顶，比原位置差出小半屏。

原因：`getCurrentPage()` 是"可见占比最大的页"。视口同时露出上一页的下半和当前页的上半时，当前页的可见区域从它自己的页顶开始，`original.pageY` 自然是 0——页内偏移信息在"当前页"这一项里根本不存在。

解法：锚点不用"当前页"，用"最顶上那个可见页"（`pageVisibilityMetrics` 里 pageNumber 最小的项）。它的可见区 origin 就是视口左上角在该页页坐标里的位置，round-trip 精确：

```ts
const top = metrics.pageVisibilityMetrics.reduce((a, b) => (b.pageNumber < a.pageNumber ? b : a));
// 存 top.pageNumber - 1 和 top.original.pageX / pageY
```

`getCurrentPage()` 继续用于页码显示；只是持久化锚点换页。配合 22 的 gap 补偿，三档 zoom 下 round-trip 漂移为 0。
