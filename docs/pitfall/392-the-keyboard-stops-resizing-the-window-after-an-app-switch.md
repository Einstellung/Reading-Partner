# 切走再回来，键盘就不再改 `window.innerHeight` 了

## 现象

iPad 上打开整窗对话，点输入框弹键盘，一切正常。切到别的 app 再切回来，输入框
仍然在键盘上方，但 Lumen 的角落跑到了键盘底下——离它该在的位置差 250px。

实测（iPad Air 13 竖屏，iOS 26.5 模拟器，1024×1366）：

| 时刻 | `innerHeight` | `visualViewport.height` | 根节点 padding-bottom | 输入框 top/bottom | Lumen top/bottom |
|---|---|---|---|---|---|
| 键盘弹起（没切过 app） | 963 | 963 | 0px | 874 / 910 | 753 / 825 |
| 切走 15 秒再回来 | 1366 | 963 | 403px | 874 / 910 | 1156 / 1228 |

两行的输入框位置一模一样，Lumen 差了一屏的四分之一。

## 原因

WKWebView 对软键盘有两种做法，同一台机器上都会出现：

- **缩 webview**：原生把 webview 的 frame 改矮，`window.innerHeight` 跟着变，
  visual viewport 和 layout viewport 仍然相等，`window` 上有 resize。
- **不缩 webview**：frame 保持整窗高，只有 visual viewport 变矮。`window` 上
  **什么都不发**，只有 `visualViewport` 的 resize / scroll。

第二种就是切走再回来之后的状态。`useKeyboardInset` 本来就听 `visualViewport`，
所以输入框的避让两种都对；`useCornerLift` 只听 `window` 的 resize，于是在第二种
状态下用的是没有键盘那会儿量到的盒子。

还有第二层：`composerLift` 拿 `window.innerHeight` 减输入框底边判断"它是不是
贴着底边"。第二种状态下输入框被 padding 顶到 910，离 layout viewport 的底边
1366 还有 456px，远超 96px 的带宽，于是规则判定"输入框不在底边"，升程归零——
角落直接落到输入框那条带上。

第三层：即使听了 `visualViewport`，事件发出的那一刻 React 还没把 403px 的
padding 渲染上去，`getBoundingClientRect()` 读回来的还是旧位置。

## 解法

`useCornerLift` 三件一起做：

- `window` 的 resize 和 `visualViewport` 的 resize / scroll 都订阅。
- 量两个高度而不是一个。判断"输入框在不在底边"用**可见**区域的底边
  （`visualViewport.offsetTop + visualViewport.height`）；算升多少用 **layout
  viewport** 的高度，因为角落是 `fixed`，它的 `bottom` 偏移是从那条边数的。
- 每次测量做两遍：事件里一遍，`requestAnimationFrame` 里再一遍，等那次渲染把
  padding 落上去。两遍都在值没变时交回同一个对象，所以第二遍不要钱。

推论：webview 里任何"东西离窗口底边多远"的判断，都不能只问 `window`。
