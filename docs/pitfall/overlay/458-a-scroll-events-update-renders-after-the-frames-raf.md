# scroll 事件里的更新，渲染在这一帧的 rAF 之后

## 现象

iPad 这次启动还没切过 app（坑 454 那种文档上卷的状态），整窗对话贴底的输入框一点，键盘起来，外壳挪到 `top: 340px`，输入框在 800/862，Lumen 却在 774/846，压着发送键，没有抬。切过 app 之后（坑 392 那种）同一个输入框 Lumen 在 696/768，是对的。未修时六次六次都压着。

## 原因

文档上卷那一步，外壳的新 `top` 是在 visual viewport 的 `scroll` 事件里 `setFrame` 的。React 把 `scroll` 当 continuous 事件，这次更新不在微任务里渲染，而是排进 Scheduler 的任务。`scroll` 事件本身是在浏览器「更新渲染」那一步派发的，同一步随后就跑这一帧的 `requestAnimationFrame` 回调，事件里新申请的 rAF 也在这一轮。`useCornerLift` 在事件里量一次输入框、再在 rAF 里补量一次（坑 392），两次都跑在外壳挪动的那次渲染之前，量到的是没挪时的盒子（离可见区底边远，判成不挡；这个先后是按规范推的，实测的是改成同步渲染之后 Lumen 就对了），之后输入框只是换了位置、尺寸没变，`ResizeObserver` 不响，没有人再量。

## 解法

`useKeyboardFrame` 的事件回调用 `flushSync` 包住 `setFrame`，外壳在事件返回之前就挪好了，同一帧里后面的测量读到的都是挪过的位置。首次订阅时那次读取仍是普通 `setState`（它在 passive effect 里，不能 `flushSync`）。修完 iPad 上连弹 12 次，文档上卷的 8 次和只缩 visual viewport 的 4 次，Lumen 都在 696/768。
