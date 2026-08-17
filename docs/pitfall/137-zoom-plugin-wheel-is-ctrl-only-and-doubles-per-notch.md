# 缩放插件的 `enableWheel` 只管 ctrl/meta+滚轮，而它一格的步长是把 `deltaY` 当百分比算出来的

## 现象

两件事，同一个 handler。

一，`ZoomGestureWrapper` 的 `enableWheel` 关了半年，理由写在注释里："关掉才能让桌面滚轮保持滚动而不是缩放"。于是桌面端没有滚轮缩放。实测打开它，裸滚轮照样滚页面，什么都没被吃掉。

二，打开之后，触控板捏合手感正常，鼠标滚轮拨一格从 100% 直接跳到 200%，再一格 400%。实测（headless Chromium，`deltaY=100`）2.091 → 4.18，正好翻倍。

## 原因

`node_modules/@embedpdf/plugin-zoom/dist/react/index.js` 的 `handleWheel`：

```js
if (!e.ctrlKey && !e.metaKey) return;   // 裸滚轮在这里就走了
e.preventDefault();
...
const zoomFactor = 1 - e.deltaY * 0.01; // delta 直接当百分比，不看 deltaMode
accumulatedWheelScale *= zoomFactor;
accumulatedWheelScale = Math.max(0.1, Math.min(10, accumulatedWheelScale));
updateTransform(accumulatedWheelScale);  // CSS transform 预览
// 最后一次事件后 150ms commit
```

第一行决定了 `enableWheel` 的真实语义：它只是 ctrl/meta+滚轮这条路径的开关，裸滚轮从来不归它管。触控板的捏合在 webview 里也是以 ctrl+滚轮到达的，所以同一个开关顺带覆盖了它。

`1 - deltaY * 0.01` 决定了步长，而且不看 `deltaMode`（坑 129）。Chromium 系一格 `deltaY=100`，因子就是 2；报 `deltaMode=1` 的引擎一格 `deltaY=3`，因子 1.03，几乎不动。触控板的 delta 是个位数且事件密集，所以它落在舒服的区间纯属巧合。

## 解法

打开 `enableWheel`，并把注释写成它的真实语义（`src/reading/engine/EmbedPdfView.tsx`）。锚点跟指针、CSS transform 预览、150ms 后 commit、0.1–10 的 clamp 都是插件自带的，实测锚点在有滚动余量的那个轴上精确保持（页面窄于视口时水平方向没有余量，插件重新居中，这是对的）。

步长没有配置项。要改只能自己挂 `wheel` 监听走 `requestZoom(level, center)`，代价是连插件的预览和累积一起重写——触控板一秒几十个事件，没有预览就是每个事件一次重排。当前接受插件的默认步长。
