# 纵向橡皮筋不能靠平移滚动内容做出来，浏览器会把偏移量原样抵消掉

现象：翻页模式的橡皮筋写法（给滚动容器的内容元素写 `transform: translate3d(...)`，rAF 衰减回弹，坑 41）搬到纵向连续滚动上，到顶那一侧还能看见回弹，到底那一侧完全看不出动静——手指拉过底部，内容纹丝不动。

原因：`transform` 会改变滚动容器的可滚动溢出区。内容向上平移 B 像素，底部溢出就少了 B，`scrollHeight` 跟着少 B，`maxScrollTop` 也少 B。而此时 `scrollTop` 正贴在原来的最大值上，浏览器立刻把它夹回新的最大值，也就是往回退了 B。视觉位置 = `-scrollTop + T`，两项一加正好抵消。这不是数值凑巧：内容平移和滚动位置是同一条轴上的两个加数，夹紧规则限制的就是它们的和，所以任何写在滚动内容上的平移都不可能把内容推出滚动范围之外。翻页模式没踩到是因为它锁在 fit-page，压根没有可滚范围，夹紧无从发生。

解法：纵向橡皮筋平移**滚动容器自己**（`el.style.transform`），不碰它的内容。容器的 transform 不参与它自身的溢出计算，`scrollTop`/`scrollHeight` 全程不变，没有反馈也没有夹紧。外面那层包裹 div 负责 `overflow: hidden` 把移出画面的那条边裁掉，并用和视口一样的背景色（`#f1f3f5`）填上另一侧露出来的缝——这条缝就是回弹本身的样子。坑 41 的两条规则照旧：直接写 `transform`，回弹用 rAF，静止时清成空串，不留 CSS transition。

副作用：pinch 的 `initializeGestureState` 读 `container.getBoundingClientRect()`，橡皮筋期间这个 rect 带着偏移，缩放锚点会偏。和坑 41 同一个缓解手段——第二根手指落下时 `suspendFingerGesture` 先把橡皮筋清零，所以 pinch 开始时偏移量已经是 0。

物理量（阻尼、最大拉出距离、回弹刚度、惯性撞边界的吸收率）都是 `src/reading/engine/vertical-gesture.ts` 顶部的具名常量，元素和 rAF 在 `src/reading/engine/attach-touch.ts`。

注：这条是从规范和坑 41 观察到的「橡皮筋期间 scrollWidth/scrollHeight 会变」推出来的，真机上先按到底那一侧验证——如果到底能弹、到顶也能弹，就是对的。
