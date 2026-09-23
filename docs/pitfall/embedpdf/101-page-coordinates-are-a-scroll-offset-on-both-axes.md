# scrollToPage 的 pageCoordinates.x 会原样变成水平滚动位置

现象：翻页模式下点侧栏的标注跳过去，整页横向错位——左边被裁掉一条，右边露出同样宽的书桌底色。翻页、滑动、切布局、转屏、点大纲都不会。真机实测（iPad，318 页的书）：滚动容器 `clientWidth` 820、页宽 819.5，页面 `getBoundingClientRect().left` 是 −60.1（居中应为 +0.25）。`maxScrollX` 263167，离夹取差四个数量级，不是被浏览器钳的。

原因：`scrollToPage` 把 `pageCoordinates` 加进滚动位置的两个分量，不只是竖直那个。scroll 插件的 `getScrollPositionForPage` 返回 `x = 页左边缘px + 标注x × scale + viewportGap`，viewport 插件的 `scrollTo` 在 `alignX === undefined` 时直接 `finalX = x`：

```js
let finalX = x;
if (alignX !== void 0) finalX = x - metrics.clientWidth * (alignX / 100);
```

所以传了 `pageCoordinates` 而不传 `alignX`，页面就往左走"标注离页左边缘多远"那么远。60.35px 正是那条高亮的 `rect.origin.x`（45pt）乘当时的 scale（819.5/612 ≈ 1.339）。错位量与点的是哪条标注有关：左边距的标注偏一点，右半页的标注偏半屏。

其它跳转路径不传 `pageCoordinates`，页内 x 恒 0，撞不上；它们又都经 `centerPage` 补了 `alignX`，所以翻页模式的居中义务（`layout-modes.ts` 的 `placePage: "center"`）只有标注跳转这一条没履行。错位一直存在，是 `viewportGap` 改成 0 之后竖屏页宽正好等于视口宽、两侧再无余量，才第一次可见。

解法：水平方向永远显式给 `alignX`，规则是"把该看的东西放到屏幕中间"。翻页模式下页面放得下时该看的是整页——`x` 传 0，`alignX` 传 `pageCenterAlign(页宽px, 视口宽)`，和翻页时同一个数；捏合放大后页宽超过视口、横向有得滚，该看的是标注本身——`x` 传标注 x，`alignX` 传 50，落点两端由浏览器钳住，标注贴页面左右边缘时也不会跳出可视区。竖排两种情况都是 0。纯函数 `markPlacement` 在 `src/reading/engine/layout-settle.ts`，有单测；调用点是 `src/reading/engine/wire-engine.ts` 的 `jumpToMark`。

另：`getScrollPositionForPage` 里的 `transformPosition` 施加的是**查看器**的旋转，宿主没注册 rotate 插件，这个值恒为 0，所以上面传的 x 原样进滚动位置（PDF 自己的 `/Rotate` 由 PDFium 烘进 `rotatedWidth/rotatedHeight`，不走这条）。哪天真开旋转功能，`x: 0` 在 rotation≠0 时会被映射出非零的 x 分量，这里要重算。
