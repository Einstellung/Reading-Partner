# 缩放插件的 `enableWheel` 只管 ctrl/meta+滚轮，而它一格的步长是把 `deltaY` 当百分比算出来的

## 现象

两件事，同一个 handler。

一，`ZoomGestureWrapper` 的 `enableWheel` 关了半年，理由写在注释里："关掉才能让桌面滚轮保持滚动而不是缩放"。于是桌面端没有滚轮缩放。实测打开它，裸滚轮照样滚页面，什么都没被吃掉。

二，打开之后，触控板捏合手感正常，鼠标滚轮拨一格从 100% 直接跳到 200%，再一格 400%。实测（headless Chromium，`deltaY=100`）2.091 → 4.18，正好翻倍。用户试了一次就否了。

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

`1 - deltaY * 0.01` 决定了步长，而且不看 `deltaMode`（坑 129）。Chromium 系一格 `deltaY=100`，因子就是 2；报 `deltaMode=1` 的引擎一格 `deltaY=3`，因子 1.03，几乎不动。触控板的 delta 是个位数且事件密集，所以它落在舒服的区间纯属巧合。步长没有配置项，插件只暴露 `enablePinch` / `enableWheel` 两个布尔。

## 解法

`enableWheel` 关掉，自己在同一个滚动容器上挂 `wheel` 监听，走 `zoomScope.requestZoom(level, center)`，`center` 是视口 client box 内的偏移（`clientX - containerRect.left`，和插件 `commitZoom` 传的是同一套坐标）。`enablePinch`（真触摸）留着，两条路不会看到同一个事件。做法在 `src/reading/engine/gesture/wheel-zoom.ts`：

- delta 先按 `deltaMode` 归一到像素（`src/platform/app/wheel.ts`，和聊天列共用）。
- 步长用指数：`factor = exp(-px / 800)`。缩放是乘法的，而鼠标和触控板的差别只在每秒送多少 delta，指数曲线一条就够——把捏合那几十个小事件的因子乘起来正好等于 `exp(总和)`。实测 Chromium 一格 `deltaY=100` 是 1.133，连续六格 1.133/1.132/1.133/1.133/1.133/1.133，反向拨回去回到原值。
- 累积的 target 在事件之间用完整精度自己保存，不回读插件状态：插件存的值只有三位小数，每个事件回读一次会把捏合的小步量化没。停手 250ms 算一次手势结束，下一格从当时的实际缩放重新起算，所以中间按过工具栏、按过 ctrl+0、resize 后重新 fit 都不用监听。
- apply 一帧一次（rAF 合并），不是一个事件一次。

性能实测（headless Chromium，软件光栅，1280×900，vertical 适宽 2.091 起，180 个合成 ctrl+wheel 事件约 60Hz）：本实现 109/374 帧超过 32ms，插件自己那套 transform 预览 + 尾部 commit 是 116/372，同一个量级；同样的事件流不带 ctrl（没有任何缩放发生）是 0/198。也就是说卡顿来自这个缩放级别下引擎重新出栅格，跟谁来驱动缩放无关，复刻插件的预览换不到东西。把 apply 再节流到 32ms 一次也测了，110/373，没有区别。
