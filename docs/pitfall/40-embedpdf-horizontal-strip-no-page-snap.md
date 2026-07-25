# 横向布局是一条紧挨排布的页带，scrollToPage 左对齐，没有"一屏一页"这回事

现象：翻页模式（`ScrollStrategy.Horizontal`）下整页适配后，当前页贴在视口左边，右边露出下一页的一大块；横屏尤其明显（A4 纵向页按高度适配后宽度只有视口的一半多）。看上去像半页并排，不像一页一屏。

原因：`HorizontalScrollStrategy.createVirtualItems` 只是把每个 item 依次 `xOffset += width + pageGap` 排成一行，`getCenteringOffsetX` 显式返回 0（注释说横向布局不做居中）。`pageGap` 来自插件注册时的 `defaultPageGap`（未缩放单位，随 scale 一起放大），没有 setter，运行期改不了，所以做不到"每页占满一屏宽"的页距。`scrollToPage` 走 `getScrollPositionForPage`，返回的是页左上角 + `viewportGap`，即页面左对齐；引擎也没有任何 scroll-snap / 分页吸附。

解法：宿主自己居中。`viewport.scrollTo` 支持 `alignX`（百分比，`finalX = x - clientWidth * alignX/100`），所以翻页时传 `alignX = 50 * (1 - 页宽px / 视口宽px)`（钳在 0..50，页比视口宽时为 0），页就落在屏幕正中，两侧对称露出邻页边缘——这反而是"还有下一页"的提示。页宽从 `scrollScope.getLayout().virtualItems` 里找到该页的 item 宽度乘当前 `currentZoomLevel` 得到。纯函数 `pageCenterAlign` 在 `src/reading/engine/paged-gesture.ts`，有单测。

顺带：`ZoomMode.FitPage` 取的是全文档所有页里最大的宽和高算出的比例（`computeZoomForMode` 遍历 spreads 取 max），所以一次算出的适配比例对每一页都成立，不需要逐页重算。视口尺寸变化时插件只在 `zoomLevel` 仍是 fit 模式（不是数字）时才自动重算，捏合缩放会把它变成数字——转屏后要自己 `requestZoom(FitPage)`。
