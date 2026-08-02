# Portal 出去的全屏页不跟着手机壳的返回手势走

## 现象

`SettingsView` 是手机壳里的一个栈条目，左缘右滑要把它整页推出去。它今天是 `fixed inset-0` 的流内子元素，跟着走没问题。换成 Radix 的 `Dialog` 并按惯例 `DialogPortal` 出去之后，滑动时动的是设置页底下那个屏幕（看不见），设置页纹丝不动，然后突然消失。

同一次滑动还根本起不来：手势的 `pointerdown` / `touchmove` 监听挂在会滑动的那个元素上（capture 阶段），Portal 出去的子树不是它的后代，落在设置页上的手指从来不经过那些监听。`modal` 给 `body` 加的 `pointer-events: none` 又让底下那层也接不到。

## 原因

两件事都只对后代成立。

`position: fixed` 的元素遇到有 `transform` 的祖先时，包含块从视口变成那个祖先——手机壳正是拿 `transform` 平移整个界面的（坑 41）。Portal 之后没有那个祖先，浮层重新贴回视口。

事件传播路径是 DOM 树的路径。Portal 改的正是 DOM 树。

## 解法

全屏那种 content 不 Portal。Radix 的 `Dialog.Portal` 本来就是可选的，`Dialog.Content` 直接渲染在原地一样能用，DOM 位置和换之前完全一样，`hideOthers` 的 `aria-hidden` 沿着树往上走照样正确。

实测（把会滑动的那个元素设成 `translate3d(120px,0,0)`，量浮层左缘的位移）：

| | 旧版（流内 fixed） | 新版 |
|---|---|---|
| 全屏设置页 | 120 | 120（不 Portal） |
| 居中对话框 | 120 | 0（Portal 出去了） |

居中那个是对照：它确实不跟着动了。这对它无所谓——它浮在阅读区上面，不是手机壳的一个栈条目。
