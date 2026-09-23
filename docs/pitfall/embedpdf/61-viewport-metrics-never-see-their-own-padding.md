# 视口插件量到的是它给自己加 padding 之前的尺寸，而且再也不会重量

## 现象

翻页开关已经开着，打开书落到的不是一整页：页面比屏幕窄一圈，右边缘露出下一页的一条。等多久都不会自己纠正，切一次布局才好。

Chromium 加 6× CPU 节流必现（不节流时看运气）。834×1194 视口、612×792 的页：fit-page 落在 1.33，应该是 1.362；页宽 814 而不是 834，右边露出 17px 的下一页。1024×1366 落 1.64（应 1.673），900×1000 落 1.237（应 1.263）。

## 原因

两件事叠在一起。

**插件的视口度量停在 padding 之前。** `Viewport` 组件把 `viewportGap` 当 padding 用，而这个 state 初值是 0，要等一个 effect 才写成 10。插件的度量来自挂在同一个容器上的 `ResizeObserver`，它看的是 content box：容器是 `width:100%`，加 padding 只改 client box（834 → 854），content box 纹丝不动，观察器不会再触发。于是只要 `observe()` 那一次立即回调跑在 padding 落地之前——主线程一忙就是这个顺序——插件就整段会话都以为视口窄 2×gap。

后果有两个。fit 是插件用自己缓存的 clientWidth 算的（`availableWidth = clientWidth - 2*vpGap`，再 `Math.floor(x*1e3)/1e3`），所以每个 fit 都小 2×gap，一整页填不满屏幕，邻页从缝里露出来。`alignX` 也是插件拿同一个数解的，而宿主按元素真实的 clientWidth 算居中，两边差 10px。重发 `requestZoom` 修不了：它照样用那份缓存重算。

**打开这条路当时根本不过 settle。** 还原走 `turnToPage`，而挂载时 zoomLevel 本来就是 FitPage（插件默认值就是按还原的布局播下去的），于是它走同步的 `centerPage` 快路径——不等几何，也不复核落点。切布局修好的那套（坑 56）在打开时一次都没跑过。

## 解法

判据加两条，都在 `src/reading/engine/layout-settle.ts`（有单测）：

- `metricsFresh`：插件缓存的 client box 必须等于元素自己的。缺这条的修法是把元素的真实度量交给插件（`setViewportResizeMetrics`，就是插件自己的 React 适配层从观察器里发的那个调用）。
- `scaleIsFit`：当前 scale 必须等于这个 zoom lock 在这个视口上解出来的 fit，按插件的方式向下取整到 3 位小数。光看 lock 的名字不够——名字是 fit-page，数值可以是从错视口上算出来的。

`settleGap` 的顺序是 metrics → zoom → model → dom：视口错的时候重发 zoom 只会再错一次。

打开时 paged 的还原改走 `settleLayout`，和切布局同一条路，只还原页码。

刷度量要省着用：每次都算一次 resize，缩放插件 150ms 后会按缓存里的旧滚动位置重写一遍（坑 57）。所以数值相同就不刷；并且落点确认时顺手把真实滚动位置回写给插件（`setViewportScrollMetrics`），不然实测居中后 3ms 就被拉回 0，180ms 后才被重发修回来——中间那段就是肉眼可见的闪一下第 1 页。

`layoutReady` 时无条件刷一次（那时 padding 一定早就落地了），vertical 也跟着受益：它没有 settle 兜底，fit-width 一旦算错就一直错。

实测（6× 与 10× 节流，834×1194 / 1024×1366 / 900×1000，另外人为吞掉一到两次居中滚动）：都落在整页上，缩放是该视口的 fit，页码是存的那一页。把插件的度量改成永远修不好之后，settle 烧完 24 帧的预算照样把页放上去，只是停在那个小一号的 fit 上——不会挂着。

复现用 `embedpdf-spike.html?page=7&zoom=2.142&px=4.67&py=703.19&layout=paged`（`layout` 是为这个坑加的），节流用 CDP 的 `Emulation.setCPUThrottlingRate`。
