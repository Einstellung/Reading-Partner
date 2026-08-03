# scrollToPage 的 pageCoordinates.x 会原样变成水平滚动位置

现象：翻页模式下点侧栏的标注跳过去，整页横向错位——左边被裁掉一条，右边露出同样宽的书桌底色。翻页、滑动、切布局、转屏、点大纲都不会。真机实测（iPad，318 页的书）：滚动容器 `clientWidth` 820、页宽 819.5，页面 `getBoundingClientRect().left` 是 −60.1（居中应为 +0.25）。`maxScrollX` 263167，离夹取差四个数量级，不是被浏览器钳的。

原因：`scrollToPage` 把 `pageCoordinates` 加进滚动位置的两个分量，不只是竖直那个。scroll 插件的 `getScrollPositionForPage` 返回 `x = 页左边缘px + 标注x × scale + viewportGap`，viewport 插件的 `scrollTo` 在 `alignX === undefined` 时直接 `finalX = x`：

```js
let finalX = x;
if (alignX !== void 0) finalX = x - metrics.clientWidth * (alignX / 100);
```

所以传了 `pageCoordinates` 而不传 `alignX`，页面就往左走"标注离页左边缘多远"那么远。60.35px 正是那条高亮的 `rect.origin.x`（45pt）乘当时的 scale（819.5/612 ≈ 1.339）。错位量与点的是哪条标注有关：左边距的标注偏一点，右半页的标注偏半屏。

其它跳转路径不传 `pageCoordinates`，页内 x 恒 0，撞不上；它们又都经 `centerPage` 补了 `alignX`，所以翻页模式的居中义务（`layout-modes.ts` 的 `placePage: "center"`）只有标注跳转这一条没履行。错位一直存在，是 `viewportGap` 改成 0 之后竖屏页宽正好等于视口宽、两侧再无余量，才第一次可见。

解法：跳到页内某点时，页内坐标只给竖直方向用，水平方向按布局补对齐参数——`x` 传 0，`alignX` 翻页模式传 `pageCenterAlign(页宽px, 视口宽)`（和翻页时同一个数），竖排传 0。纯函数 `markPlacement` 在 `src/reading/engine/layout-settle.ts`，有单测；调用点是 `EmbedPdfView.tsx` 的 `jumpToMark`。
