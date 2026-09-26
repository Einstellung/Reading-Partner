# 读视口的 state updater 会被 React 重放，每次给一个新对象

## 现象

iPhone 竖屏打开 EPUB 课堂、点输入框弹键盘，再转横屏：整个 `#root` 变空，控制台是 `Maximum update depth exceeded`，抛在课堂底下阅读器顶栏的 `PenToolbar` 那个 layout effect 的 `setPalettePos(null)` 上。模拟器上七次带键盘转横屏白了两次。插桩看到那一下 `PenToolbar` 的 layout effect 连跑 52 次，每次读到的 `viewport` 都是 956x440、`margin` 也一样，`KeyboardShell` 只渲染了一次，不是 `offsetTop` 来回跳。

## 原因

转屏时 WebKit 先发 visual viewport 的 `scroll`（这时还是 440x543），约 80ms 后才发 window 的 `resize`（956x440）。React 按事件类型给更新定优先级：`scroll` 是 continuous，放到 Scheduler 的任务里渲染；`resize` 是 discrete，走 SyncLane，微任务里就渲染。转屏那会儿主线程忙，`scroll` 那次更新还没渲染 `resize` 就到了（十次转屏里四次是这个顺序）。

SyncLane 的渲染跳过低优先级的 `scroll` 更新，后面的 `resize` 更新留在队列里，每次渲染都从 `scroll` 之前的 base state 重算一遍。`useViewportSize` 的 updater 是 `setSize(prev => { const next = read(); ... })`：`read()` 写在 updater 里面，每次重放都现读视口，和 base state（440x543）一比不等，于是每次渲染都返回一个新对象。`PenToolbar` 的 layout effect 依赖 `viewport`，对象一换它就重跑，跑了就 `setPalettePos(null)`。这个 fiber 身上还挂着没处理的 `scroll` lane，eager bailout 不成立，于是又排一次 SyncLane：再渲染、再重放、再出新对象、再跑 effect。一直到第 51 次，React 报错并把整棵树卸掉。

同样把读取写在 updater 里的还有 `useOverlaySafePadding`、`useCornerLift` 和 `useCornerDrag`。

happy-dom 里能稳定复现：先在 act 外派一个 vv `scroll`，再用 `flushSync` 派 `resize`（`tests/ui/components/reader/pen-toolbar-viewport.test.tsx`）。

## 解法

测量放在事件处理函数里，updater 只拿测好的值和 `prev` 比：`const next = read(); setSize(prev => same(prev, next) ? prev : next)`。这样重放每次拿到的都是同一个 `next`，对象身份不变，effect 不重跑。四处都这样改了。另外 `PenToolbar` 调色板关着时 layout effect 直接返回、不再 `setPalettePos(null)`，因为 layout effect 里的 setState 即使值没变也可能多排一次同步渲染；清位置挪到打开调色板的点击里做。

修完之后十次带键盘转横屏加横屏里失焦再聚焦，其中四次是上面那个事件顺序，`PenToolbar` 的 layout effect 每次转屏跑 3 次；竖屏十次弹起收起，没有一次报错。
