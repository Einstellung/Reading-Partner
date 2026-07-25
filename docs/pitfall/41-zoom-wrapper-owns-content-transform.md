# 视口里那个内容元素的 transform 是缩放预览在用的，橡皮筋不能给它留 CSS transition

现象：翻页模式下想给"没得滚"的方向做橡皮筋（页面跟手挪几像素再弹回），最自然的写法是给滚动容器的内容元素加 `transform: translate3d(...)` 加一段 `transition` 做回弹。这么写之后双指缩放的实时预览会变得拖泥带水、跟不上手指。

原因：`ZoomGestureWrapper` 渲染的就是滚动容器的第一个子元素（`display:inline-block` 的 div），`useZoomGesture` 在 pinch 期间每帧往**同一个元素**写 `element.style.transform = translate(...) scale(...)` 做预览，提交时 `requestZoomBy` 再把 transform 重置成 `none`。我们留在这个元素上的 `transition: transform` 会把引擎每帧的预览也一起补间，于是缩放跟手性没了。另外回弹动画未结束时若开始 pinch，`initializeGestureState` 读到的 `getBoundingClientRect` 带着橡皮筋偏移，缩放锚点会偏。

解法：橡皮筋直接写 `transform`，回弹用 rAF 自己衰减，落地时把属性清成空串，**不要用 CSS transition**。第二根手指落下（`suspendFingerGesture`）时立刻取消回弹动画并清掉 transform，别让偏移量活到 pinch 开始之后。偏移量、衰减和"静止时写空串"这条规则收在 `src/reader-embedpdf/rubber-band.ts`，元素和 rAF 留在 `TouchInputRouter`。

注：transform 会计入滚动容器的可滚动溢出区，橡皮筋期间 `scrollWidth/scrollHeight` 会短暂变大，不影响观感，回弹清零即恢复。
