# 按压 slop 与翻页路由 slop 之间的空档

## 现象

手机 EPUB 翻页模式，点击时手指漂了 12px、20px（真人点击常有），页不翻，也不跟手滑：iPhone 模拟器实测两种漂移都无反应。

## 原因

同一根手指有两个读者。按压状态机（`flow-gesture.ts`）的 `PRESS_SLOP_PX` 是 8：一超就进 released，抬手不算点击。翻页路由（`reading/engine/gesture/paged-gesture.ts`）的 slop 是 10，超了才接管跟手，要拖过 22% 屏宽或 0.45px/ms 才翻，否则弹回。8px 以上、够不上一次翻页的按压，两边都不认。

这个 reducer 最早是给滚动模式写的：那里走出 slop 就是浏览器的滚动，浏览器接着会 `pointercancel`，所以按距离放手是对的。翻页模式没有原生滚动，拖动是路由的，距离不能代替「有人接管了」。

## 解法

down 事件带 `slopPx`。滚动模式和返回带仍是 `PRESS_SLOP_PX`（8，默认）；翻页模式的页面上是 `PAGED_TAP_SLOP_PX`（30）：走出 8px 只取消长按起划线的资格（`still: false`），走出 30px 才结束按压。路由跟手后弹回的拖动因此仍是点击。

路由真翻了页时不能再算一次点击（快速轻扫 20px 就够速度阈值）。路由每次拖动结束都同步调 `turnToPage`，弹回也调（目标是起始页），而且发生在 scroller 捕获阶段的 pointerup 里，早于 frame 冒泡阶段的状态机。paged-view 在 `turnToPage` 里看目标页和当前页不同，就给状态机喂 `yield`，这次按压作废。

不要拿路由的 `setPointerCapture`（`gotpointercapture`）当「被接管」的信号：路由 10px 就捕获，12px 的漂移照样会被判成拖动。
