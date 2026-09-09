# foliate 的 `max-inline-size` 不限行宽，只决定分几栏；而且它带单位就废了

## 现象

EPUB 阅读面板按 foliate 的属性设了 `max-inline-size: 40em`、`max-column-count: 1`，指望正文行宽被压到 40em。在 WebKitGTK 里量出来的是：1280px 的窗口下 `column-width` 是 `1198px`，一行一百二十个字符，横跨整个屏幕。

翻页模式（`flow: paginated`）下才这样；滚动模式（`scrolled`）正常，正文被限制在中间。

## 原因

两条叠在一起。

`paginator.js` 的 `#beforeRender` 里，翻页那条路是：

```js
const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize))
const columnWidth = (size / divisor) - gap
```

`maxInlineSize` 只进了 `divisor`——它决定的是"这么宽的容器放得下几栏"，不是"一栏最宽多少"。栏宽永远是容器宽度除以栏数。所以 `max-column-count: 1` 加任何 `max-inline-size`，得到的都是容器满宽的一栏。滚动那条路不一样，`scrolled()` 直接把 `columnWidth` 写成 `body` 的 `max-width`，所以那边看起来是对的。

第二条：这些属性全部是

```js
parseFloat(style.getPropertyValue('--_max-inline-size'))
```

读出来当像素数用。`parseFloat("40em")` 是 `40`。于是 `ceil(1280/40)` 是 32，`min(1, 32)` 还是 1——数值错得离谱，结果却和写对了一样，因为这个值本来就管不到行宽。`gap`、`margin`、`max-block-size` 同理，一律不能带单位。

## 解法

行宽在元素上限，不在 foliate 的属性里限：`<foliate-view>` 上 `max-width: 48rem; margin: 0 auto`。包着它的那层保持满宽，翻页的左右点击区因此还是够到屏幕边缘的。

单位那半的结论后来推翻了，见坑 251：不能带的是 `em`，`px` 和 `%` 必须带——影子样式表自己也读这几个自定义属性，没单位整条 `grid-template-columns` 就废了。
