# 页间距不是一个 CSS 长度：它是未缩放页单位，而且不能用 CSS 覆盖

## 现象

想要一条"不管缩放多少都一样细"的页间分隔线。DOM 上看它就是 flex 容器的 `gap: 13.3px`，一条 CSS 规则就能压掉——压掉之后页面照样滚，但 `scrollToPage` 开始落在页缝上，翻页模式越翻越偏。

## 原因

`gap` 的值是 `documentState.pageGap * scale`（`getScrollerLayout`），而同一个 `pageGap` 也是 scroll 插件排 virtual items 时用的步长：竖排 `yOffset += height + pageGap`，横排 `xOffset += width + pageGap`。插件按 virtual items 算每一页的滚动位置，浏览器按 DOM 的 `gap` 把页面画出来。两个数一旦不等，模型说的第 n 页和屏幕上的第 n 页就差 `(n-1) × 差值`。

所以页间距只有一个来源：注册期的 `defaultPageGap`（默认 10，未缩放页单位）。运行期没有 setter（坑 40），CSS 也不许改。代价是分隔线跟着缩放一起放大：`pageGap: 2` 在 fit-width 1.362 上是 2.72px，放大到 1.762 就是 3.52px。

## 解法

只调 `defaultPageGap`，把"看起来多宽"当成 `pageGap × fit` 来选，不追求恒定像素。想要更强的分隔就往页面自己身上加：`inset: 0` 的一层画纸张底色和 `box-shadow`（阴影画在盒子外面，不进滚动区，实测 `scrollWidth` 不变）。两套取值在 `src/reading/engine/page-frame.ts`。

翻页模式下这个数还有一个非装饰的作用：整页适配后页宽正好等于视口宽，把下一页挡在屏幕外的只有这条缝。所以它不能是 0，单测盯着这一条。
