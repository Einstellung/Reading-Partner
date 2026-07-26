# 视口一变，缩放插件 150ms 后还会再写一次滚动位置

## 现象

iPad 旋转（或任何视口尺寸变化）后，翻页模式把当前页居中，画面上确实居中了，两帧之后又被拉回去，然后永远停在那里。Chromium 实测：834×1194 → 1194×834、读第 8 页，居中值 4310，最终停在 4450，屏幕上是 `7:19% 8:100% 9:66%`（居中应该是 41%/99%/44%）。

宿主这一侧的日志显示居中明明成功过：settle 第 1 帧几何合格、发出居中；第 2 帧读回 4310，判定落点到位、收工；再往后就是 4450。

## 原因

`plugin-zoom` 在构造函数里订阅视口尺寸变化时带了 `{ mode: "debounce", wait: 150 }`：

```js
this.viewport.onViewportResize((e) => this.recalcAuto(e.documentId, VerticalZoomFocus.Top),
  { mode: "debounce", wait: 150, keyExtractor: (e) => e.documentId });
```

`recalcAuto` 不只是重算 fit 的缩放值，它还用 `computeScrollForZoomChange` 算一个「焦点不动」的 `desiredScrollLeft/Top`，然后 `setViewportScrollMetrics` + `viewport.scrollTo({behavior:"instant"})`（viewport 的 React 钩子再推迟一帧）。它读的是插件缓存的 `viewportMetrics.scrollLeft`，那份缓存只有容器的 `scroll` 事件回来才更新，所以宿主刚写进去的位置它看不见，等于拿旧位置盖掉新位置。

宿主自己在 resize 里调 `requestZoom(FitPage)` 走的是同一段代码，所以一次旋转有两次这样的写入：一次立刻（宿主触发的），一次 150ms 后（插件自己的 debounce）。实测时序：resize → 宿主 requestZoom + settle → 主线程忙约 300ms 重排 14 页 → settle 首帧居中 → 落点 4310 → debounce 到期的 recalcAuto 落到 4450 → 没人再看。

「确认落点」这件事本身没错，错在见好就收：确认成功的那一帧正好在被覆盖之前。

## 解法

落点确认要覆盖整个帧预算，不是第一次到位就退出。settle 在 24 帧内一直复核，位置被别人挪走就再发一次（上限 3 次），预算到点才停。旋转本身走和切布局同一条 settle 路径，serial 保证连着转两次时旧的那次让位。
