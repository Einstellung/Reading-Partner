# overlayer 的 SVG 挂在父页，坐标却是 frame 的

## 现象

`overlayer.hitTest({x, y})` 从父页的 pointer 事件直接传 `clientX/clientY`，滚动模式下一次都命中不了；翻页模式下偏一个左边距。反过来，把 `range.getBoundingClientRect()` 当成父页坐标交给标注弹窗，弹窗跑到屏幕外面。

## 原因

两件事各对一半。SVG 确实在父页（`paginator.js` 的 `set overlayer` 把 `overlayer.element` append 到 `View.#element`，不在 iframe 里），所以父页的 pointer 事件够得着它。但里面的矩形是 `range.getClientRects()` 画的，那是 **frame 自己的视口坐标**；foliate 靠给 SVG 设 `left`/`top`/`margin` 把两个空间对齐，`hitTest` 也是按 frame 坐标写的（它原本绑在 frame document 的 click 上）。

滚动模式下差得离谱，是因为 foliate 不让 frame 内部滚动：iframe 元素被撑成整章那么高（实测一章 129485px），由父页容器滚。所以 iframe 的 `getBoundingClientRect().top` 是个很大的负数，frame 坐标和父页坐标差的就是这个数。

## 解法

一次减法，两个方向：

```js
const box = doc.defaultView.frameElement.getBoundingClientRect()
overlayer.hitTest({ x: clientX - box.left, y: clientY - box.top })      // 进
const r = range.getBoundingClientRect()
const rect = [r.left + box.left, r.top + box.top, r.right + box.left, r.bottom + box.top]  // 出
```

`caretRangeFromPoint` 也要走「进」那一侧。屏幕外的标注算出来是负坐标，这是对的，不是 bug——它就在视口上面。
