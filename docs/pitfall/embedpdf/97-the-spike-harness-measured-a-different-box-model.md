# spike harness 不引 styles.css，量到的盒模型不是 app 的

## 现象

在 `embedpdf-spike.html` 里量视口：窗口 917 宽，滚动容器 `offsetWidth` 937.4，比窗口还宽 20。app 里同一段代码量出来是等宽的。

## 原因

`Viewport` 组件写的是 `width: 100%` 加 `padding: ${viewportGap}px`。`box-sizing` 默认是 `content-box`，所以 100% 是内容区的宽，padding 加在外面，容器整整溢出 2×gap。app 里没这回事是因为 preflight 给了 `*{box-sizing: border-box}`——而 harness 只 import 组件，从来没 import 过 `src/styles.css`。

同一条链上还有 `line-height`：preflight 的 1.5 会把翻页模式的页带挪 1px（坑 76）。也就是说没有 preflight 的 harness 和 app 至少在两处几何上不一致。

## 解法

`spike-harness.tsx` 里 import `../../styles.css`。引擎的调试入口要和 app 用同一份全局基线，否则量出来的数不能当结论。

（这条只影响 harness 里的度量；app 一直是对的。）
