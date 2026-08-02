# 视口 gap 收两次费：既是页面四周的留白，又是每个 fit 的减数

## 现象

去掉页面四周那圈留白，本以为是纯视觉改动。把 `ViewportPluginPackage` 的 `viewportGap` 从默认的 10 改成 0 之后，834×1194 上 fit-width 从 1.33 变成 1.362，页宽从 813.95 变成 833.53，翻页模式下邻页的位置、`scrollToPage` 的落点、`centeredScrollX` 的目标值全跟着变。一个"padding"改掉了整套几何。

## 原因

`viewportGap` 是一个数，被三个地方读：

- `Viewport` 组件把它当 `padding` 写在滚动容器上（这才是看得见的留白）；
- zoom 插件解每一个 fit 都是 `clientWidth - 2 * viewportGap`（`computeZoomForMode`），所以有 gap 的页面永远填不满屏幕；
- scroll 插件的 `getScrollPositionForPage` 在每个页面的滚动位置上加一次 `viewportGap`（坑 22）。

也就是说留白不是白留的：它同时把"整页适配"的定义改小了 2×gap。翻页模式下邻页从缝里露出来（坑 61、62 的那条边）有一半是这个数直接给的。

顺带，`viewportGap: 0` 能生效纯属巧合：插件构造函数里写的是 `if (config.viewportGap) this.dispatch(setViewportGap(...))`，0 是 falsy，这条 dispatch 根本不跑；它照样是 0，只是因为 reducer 的 `initialState.viewportGap` 也是 0。要是插件的初值是 10，传 0 就会静默失效。

## 解法

把这个数和它的同伴收进 `src/reading/engine/page-frame.ts`（有单测），阅读区取 0：页面占满宽度，fit-width 就是 `clientWidth / pageWidth`。

宿主这侧不用跟着改公式——`layout-settle.ts` 的 `fitScale` / `centeredScrollX` / `pageTopScrollY` 本来就把 gap 当参数，值从插件读。要改的是单测里写死的那些数（1.33 → 1.362）。

`metricsFresh`（坑 61）留着：gap 为 0 之后视口不再给自己加 padding，那条具体的失配不会再发生，但旋转时插件的度量照样会落后于元素。

实测（834×1194 与 1194×834，竖排/翻页各 9 个状态，逐状态量页盒和标注）：标注在未缩放页坐标里恒为 `(100, 130, 200, 12)`，最大偏差 0.009 页单位（约 0.013 CSS px，是 `getBoundingClientRect` 的取整）。
