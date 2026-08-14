# `deltaY` 的单位由 `deltaMode` 决定，只按像素算的手势会在别的引擎上形同失效

## 现象

按滚轮累计位移做的手势（这里是 ctrl+滚轮缩放，一档取 40），在开发机上手感正常。换一个把 `deltaMode` 报成 1 的引擎，同样拨一格只累计到 3，要拨十几下才走一档，用户看到的是"按了没反应"——不是报错，是功能安静地不工作。

## 原因

`WheelEvent.deltaY` 的单位不是固定的，由同一个事件的 `deltaMode` 说明：

| deltaMode | 单位 | 一格滚轮的量级 |
|---|---|---|
| 0 | 像素 | 100（Chromium 系）/ 53 等，随引擎和系统设置 |
| 1 | 行 | 3 |
| 2 | 页 | 1 |

用哪种是引擎的选择，不是页面能要求的。触控板的 pinch 一律走 ctrl+滚轮，delta 是小数且事件密集，这一层再叠上单位问题。

这个项目跑在 WebKitGTK、WKWebView 和 Android WebView 三种引擎上，没有实测过它们各报哪种模式——所以是防住，不是修好了某台机器。

## 解法

累加之前先按 `deltaMode` 归一到像素，行乘一个行高常量、页乘一个视口量级常量，未知模式当像素：

```ts
function wheelDeltaPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 800;
  return deltaY;
}
```

页那个常量不必去读 DOM 求准：一次滚一屏在任何屏幕上都是大动作。见 `src/ui/components/base/chat-scale.ts`。
