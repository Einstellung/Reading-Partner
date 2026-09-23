# 单写一个 `duration-200`，这个元素的每个属性都开始过渡

## 现象

量 AlertDialog 的安全区夹取：驱动脚本给 `:root` 设一组 inset，等 150ms 再 `getComputedStyle`，读到 `max-height: 788.465px`。手算应该是 `900 - 2*max(59, 34, 16) = 782px`。等 400ms 再读就是 782px。

## 原因

shadcn 生成的 content 上有 `duration-200`。Tailwind 的 `duration-*` 只设 `transition-duration`，不设 `transition-property`，而 `transition-property` 的初始值是 `all`。于是这个元素上任何可动画属性的变化都会走 200ms 过渡：

```
transitionProperty "all"   transitionDuration "0.2s"   animationDuration "0.2s"
```

采样看得很清楚（改 inset 之后）：

```
0ms 868px   50ms 832.866px   100ms 798.992px   150ms 785.401px   200ms 782px
```

`duration-200` 在这里本来是给 `animate-in` / `animate-out` 用的（`--tw-duration` 同时喂 `animation-duration`），过渡是白送的。

## 解法

量之前等满 200ms。这一版没改 shadcn 的类：转屏时对话框的夹取跟着动 200ms 没有坏处。真要关掉就再加一个 `transition-none`（它设的是 `transition-property: none`，和 `duration-200` 不冲突，动画不受影响）。

同族：任何只写 `duration-*` 或 `ease-*` 而不写 `transition-*` 的元素都是这样。
