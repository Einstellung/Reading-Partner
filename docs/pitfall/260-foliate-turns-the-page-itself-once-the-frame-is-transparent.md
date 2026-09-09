# foliate 的 paginator 自己也在翻页，frame 透明之后就翻两次

## 现象

iPad 模拟器，翻页模式，一次滑动翻三页：`scrollLeft` 2160 → 4320，一页 720px。
点击区一次只翻一页。手指按高亮笔拖选区，选区落下了，同时页面往回翻了一页
（`frameLeft` -4263 → -3543）。

## 原因

`vendor/foliate-js/paginator.js` 在构造函数里给自己装了 `touchstart` /
`touchmove` / `touchend`（`{passive:false}`），跟着手指平移列，抬手按速度
`snap()`。它一直在那里，只是书的 iframe 以前把触摸全吃掉（坑 252），事件到不了
它；frame 改成 `pointer-events: none` 之后，触摸落在 renderer 自己身上，它和
父页的 pane 同时收到同一次滑动：foliate 按速度翻两页，pane 的 `swipeTurn` 再
翻一页。拖选区同理——pane 在选字，foliate 在平移。

Linux WebKitGTK 上不出现：那边没有 touch 事件。

## 解法

按 `vendor/foliate-js/README.md` 的约定打 `PATCHED:` 补丁，不注册那三个监听器。
三个处理函数留在类里，没人调用，上游下次的 diff 还是只落在这一处。手势只有
pane 一个读法（`EpubReaderPane.tsx`），和 PDF 那侧一致。

滚动模式不受影响：`#onTouchMove` 开头 `if (this.scrolled) return`，那条流下面
滚的是父页容器，本来就不归它。
