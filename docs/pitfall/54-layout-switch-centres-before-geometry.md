# 切布局时居中跑在几何前面，落点被浏览器夹掉，而且没人会发现

## 现象

iPad 上打开「翻页」开关，落到的不是一整页：屏幕上是两页交界，或者干脆回到第 1 页。等一两秒也不会自己纠正。纵向模式没这问题，桌面也复现不出来。

Chromium 里量到的失败态：`scrollLeft=4904`，应该是 `5324`；可见页 `7:62%, 8:55%`，四十帧之后一模一样。

## 原因

一次切布局是三件独立异步的事，而居中只等了其中零件之一：

1. `setScrollStrategy` 同步重算 virtualItems——或者一声不响什么都不做（文档那一刻不是 `loaded`，坑 42）。
2. React 提交要等到下一次 commit，滚动容器的 `scrollWidth` 才从竖排的宽度长成横向页带的宽度。
3. `plugin-viewport` 的 React 钩子把每一次 `scrollTo` 都推迟一帧：`onScrollRequest(... => requestAnimationFrame(() => container.scrollTo(...)))`。

于是在旧代码的「下一帧再断言 + 居中」那一帧上，模型已经是页带、DOM 还是竖排。`container.scrollTo({left: 5324})` 被浏览器按当时的 `scrollWidth` 夹掉，落在 0 或半页处——**而夹过的滚动位置在所有插件看来都是完全合法的滚动位置**：不报错、不发事件、没人重算。一次丢帧就永久卡在那儿。

两条本以为兜底的路，实测都不兜底：

- **重复 `setScrollStrategy(同一个)` 是空操作**。`setScrollStrategyForDocument` 开头就是 `if (!docState || docState.strategy === newStrategy) return;`。第一次调用已经把 `docState.strategy` 写成新值，所以坑 42 里「下一帧再断言一次 strategy」这行代码从来没起过作用。要真正逼出一次 `refreshDocumentLayout`，只能先切到另一个 strategy 再切回来（两次都同步，中间那个布局不会上屏）。
- **同尺度的 `requestZoom` 会发 zoom change 事件，但不会重排**（2.14.4 实测；坑 42 说的「没有 change 事件」不准）。`handleRequest` 无条件 `dispatch(setZoomLevel)` 并 `zoom$.emit`，但 `dispatchCoreAction(setScale(同一个数))` 在 core 里不产生变更，`onScaleChanged` 不触发，virtualItems 也就没人碰。竖屏 iPad 上 fit-page 和 fit-width 恒等（612×792 的页、834×1194 视口都是 1.33；1024×1366 都是 1.6405），所以切布局时缩放值本来就不变。

顺带，`plugin-viewport` 缓存的 `viewportMetrics.scrollWidth/scrollHeight` 来自容器上的 `ResizeObserver`，只有容器自己的盒子变了才更新。内容从竖排变成页带时它一动不动，所以判断「重排到没到 DOM」只能读元素本身的 `scrollWidth`。

## 解法

不按帧数等，按几何等，并且落点要复核。纯判据在 `src/reading/engine/layout-settle.ts`（有单测）：

- `geometrySettled(geometry, layout)`：zoom lock 是这个布局的 + virtualItems 的轴是这个布局的（看前两个 item 哪个坐标在推进，而不是看插件说它请求了什么）+ 元素的 `scrollWidth/scrollHeight` 已经长到装得下缩放后的内容。
- `settleGap` 说缺的是哪一半，宿主只补那一半：缺 zoom 就重发 `requestZoom`，缺模型就走「先切到另一个 strategy 再切回来」，缺 DOM 就只能等。
- `centeredScrollX` 按浏览器的方式夹一次目标值，`landedAt` 用 2px 容差比对 `el.scrollLeft`——不夹的话最后一页永远算「没到」。

宿主侧（`EmbedPdfView.setLayout` / `turnToPage`）：几何合格才居中，居中后继续复核落点，没到就重发（最多 3 次），整个过程有 24 帧的上限，到点就按现有几何居中一次收工（等于旧行为）。更新的一次切布局或翻页会让旧的 settle 直接让位。

实测：834×1194 和 1024×1366（两个 fit 相等）、900×1000（两个 fit 不等）三种视口，正反切、连切、首页末页、退出临时放大后翻页全部落在整页上；人为吞掉一到两次横向 `scrollTo` 也能自愈，旧代码则永久停在半页。
