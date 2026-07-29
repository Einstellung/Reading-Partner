# 左缘右滑：浏览器在指针通道之前就把手势抢走，pointer 事件层拦不住

## 现象

手机外壳的左缘右滑返回，只用 pointer 事件写（capture 阶段监听 `pointerdown/move/up`，过阈值再 `setPointerCapture` + `preventDefault`），在 Chromium 触摸模拟下整个手势跑不完：落指后收到 `pointerdown`，紧接着就是 `pointercancel`，永远等不到 `pointerup`。页面跟手只跟了十几像素就开始回弹（读到的 transform 是弹回途中的中间值）。

同一次滑动还把整个 app 弄没了：页面导航到 `about:blank`，React 树整棵消失，`#root` 空掉。

## 原因

两件事，都发生在 JS 拿到决定权之前。

一，`pointercancel` 是浏览器接管滚动的通知。触点移动超过它自己的 slop（Chromium 约 8px，且看的是总位移不是分轴位移）时，合成器就把这次触摸判给最近的滚动容器，之后指针事件全部作废。判给谁不看那个容器能不能往这个方向滚 —— 实测把横向拖动落在一个只能纵滚的 `overflow-y-auto` 上，照样 cancel。`preventDefault` 一个 pointer 事件对此毫无作用：规范里 pointer 事件的默认行为不包含滚动，滚不滚由 `touch-action` 和 touch 事件的 `preventDefault` 决定。

二，`touch-action` 的交集只算到"会真正执行这次滚动的那个滚动容器"为止，管不到它上面的祖先。实测：`touch-action: pan-y` 挂在外层 surface 上，里面 `overflow-x:auto` 的宽表格照样能横向滑（好消息，宽表格不会被误伤），但落在纵向滚动容器里的触摸也照样被 cancel（坏消息，那条 pan-y 根本没参与判定）。所以"给外壳加 pan-y"两头都不成立。

导航到 `about:blank` 是第三件事：没被消费的横向 overscroll 会传到视口，那是浏览器自己的历史前进/后退手势。dev 里前一条历史记录就是 `about:blank`。

## 解法

在原始 touch 通道上抢，抢得比浏览器早。surface 上挂 **非 passive** 的 `touchmove`，一旦这次触摸起手在左缘带内、且已经明显向右（实测取 3px，且横向要压过纵向 `AXIS_RATIO` 倍），就 `preventDefault()`，并且**这次序列的每一个 move 都要继续 prevent**。

三个数都是实测出来的，换一个就坏：

- 3px 抢：`pointerdown → pointerup`，手势完整走完，页面全程跟手。
- 等到 10px 再抢：已经晚了，照样 `pointerdown → pointercancel`。
- 只 prevent 第一个 move、后面放行：也是 `pointercancel`。序列不是"第一下定生死"，是持续的。

纵向拖动不满足条件，一次都不 prevent，页面照常原生滚动（起手落在左缘带里也一样），浏览器 cancel 掉指针，手势状态机顺势放弃 —— 这正是要的行为。

手势本身仍然跑在 pointer 通道上（`src/ui/components/phone/edge-back-gesture.ts` 是纯状态机，`useEdgeBack.ts` 接线），touch 通道只回答一个问题："这一下要不要从浏览器手里抢过来"。和阅读器一样是两条独立通道（坑 38）。

顺带把 `html` 上的 `overscroll-behavior-x: none` 加上：app 没有可走的浏览器历史，横向 overscroll 传到视口只会白白离开页面。app 的两个 webview 里前进后退手势本来就是关的，这条只在浏览器里起作用 —— 而浏览器正是开发时看手机形态的地方。

## 范围

Chromium（headless，`Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent`）实测。iOS WKWebView 和 Android WebView 上没验过；两边的滚动接管都会发 `pointercancel`，非 passive touchmove 的 `preventDefault` 也都拦得住原生滚动，所以结论应当同样成立，但 3px 这个数在真机上要复核。
