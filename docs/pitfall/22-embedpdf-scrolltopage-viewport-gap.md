# EmbedPDF scrollToPage 的 pageCoordinates 会多加 viewport gap

现象：用 `scrollToPage({ pageNumber, pageCoordinates: { x, y } })` 还原页内阅读位置，还原后 `pageVisibilityMetrics` 报告的可视区顶点比传入的 y 多出一截。zoom 1.5 时多 6.67 页坐标单位，zoom 1 时多 10——正好是 `viewportGap / zoom`。

原因：scroll 插件的 `getScrollPositionForPage` 算目标滚动位置时在缩放后的坐标上固定加了 `this.viewportGap`（来自 viewport 插件配置，默认 10）：

```js
return {
  x: scaledBasePosition.x + rotatedSize.x + this.viewportGap,
  y: scaledBasePosition.y + rotatedSize.y + this.viewportGap,
};
```

而保存时用的 `pageVisibilityMetrics[].original.pageX/pageY` 量的是实际可视偏移，不含 gap。存取两头对不上，每次开书往下漂一点。

解法：还原前把 gap 换算回未缩放页坐标减掉（负值截为 0，页顶行为不变）：

```ts
const gap = viewport.getViewportGap() / zoom;
scrollToPage({ pageNumber, pageCoordinates: { x: Math.max(0, x - gap), y: Math.max(0, y - gap) } });
```

实测 zoom 1 / 1.5 / 2.3 三档 round-trip 后 scrollTop 漂移为 0（spike harness）。
