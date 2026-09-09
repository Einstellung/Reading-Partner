# 书的 iframe 把落在它上面的触摸整个吃掉，父页一个事件都收不到

## 现象

EPUB 阅读面板在包着 iframe 的外层 div 上监听 pointer 事件（坑 244 说 frame 里监听不到，所以挪到了父页）。iPad 模拟器上用 idb 发真手指，点右侧翻页区、左右滑动，页码一动不动。

在那个 div 和 `window` 上都挂捕获阶段的监听器，然后点：

| 点在哪 | 父页收到的 |
|---|---|
| iframe 上（正文任意一处） | 什么都没有 |
| `<foliate-view>` 的 padding 里 | pointerdown / touchstart / pointerup / click 齐全 |
| 元素外面、surface 内 | 齐全 |

不是坐标算错，不是 `touch-action`，不是浮层挡着。落在 iframe 矩形内的触摸，父页文档里一条事件都不派发。

## 原因

坑 244 的另一半。那条说的是"父页在 frame 的 document 上装监听器收不到"，这条是"落在 frame 上的触摸也不会冒到父页"——事件被路由给了 frame 的文档，而那个文档不派发任何事件（sandbox 关掉了脚本），于是两头都没有。iframe 本来就是独立的命中测试目标，父页在 DOM 树上是它的祖先，但触摸不走那条链。

后果：翻页点击区、滑动翻页、书内链接的命中测试，全部在真机上从来没有生效过。桌面上没暴露是因为验的时候直接调的 `controller.turn()`，没走事件。

## 解法

frame 上 `pointer-events: none`，事件就落到 `<foliate-view>` 上，父页照常收，点击区翻页立刻生效（实测 2/59 → 3/59）。

代价是同一件事：iOS 的长按选区跟着没了。同一台机器上量的：

| frame 的 pointer-events | 长按 1.3 秒后 `contentDocument.getSelection()` | 父页收到事件 |
|---|---|---|
| `auto` | 9 个字符（"compliant"），系统手柄和 callout 正常弹 | 无 |
| `none` | 0 个字符 | 有 |

两个都要就得自己做：一层盖在 frame 上的透明元素接手势，判成"要选字"时把它的 `pointer-events` 关掉再把触摸交回去。这条归标注那一阶段，本文只记这个二选一是真的、量过的。
