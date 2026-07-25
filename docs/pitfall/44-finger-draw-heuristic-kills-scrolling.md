# "没见过笔就让手指画" 这条启发式会让 vertical 下的手指彻底滑不动

现象：iPad 上单指怎么滑页面都不动；同一时刻开翻页模式，从屏幕边缘起手却能正常翻页，关掉翻页又不动了。Touch debug 显示 `fingers 1 · single`，触点正常，事件层和手指计数都对。

原因：不是布局也不是几何。实测数据（Chromium 真触摸，820×1180）：vertical 下 `scrollHeight 15041 / clientHeight 1200`、`scrollWidth = clientWidth 840`、strategy `vertical`、zoom `fit-width`，开翻页再关回来数值一模一样——重排没问题，容器有的是可滚高度（坑 42 说的 fit-page 和 fit-width 数值相同确实成立，两者都是 1.339，但 setLayout 下一帧的重新断言把重排补上了）。

真正的原因是路由判定。旧的 `routePointer` 有一条启发式：选了标注工具、而且本次会话还没见过 `pointerType === "pen"` 的事件时，手指判为 draw。iPad 上用户点了笔工具、Pencil 还没落过屏，这条就成立。两条布局对 draw 的处理不对称，于是症状看着像"只有 vertical 坏"：

- vertical：`stepVertical` 在 pointerdown 就 `if (plan.action !== "scroll") break`，整根手指丢掉，什么都不动。
- paged：`pagedGestureTool` 返回 "pen" 模式，屏幕边缘 32px 内起手仍然翻页。

这条启发式还有两个放大器：锁存挂在 `pagedRef` 上，每开一本书重新挂载就清零；重启也清零。所以"每次开 app 的第一次滑动是死的"。

解法：删掉启发式，判定收口成一个显式设置 `fingerDraw`（Settings → Reader input → Draw with your finger），默认关闭——手指永远只移动页面，标注归触控笔，任何平台一样。没有触控笔的设备用户自己打开。navlock（手掌锁）优先级仍然最高：开着的时候连触控笔也只导航。路由表在 `src/reader-embedpdf/touch-routing.ts`，`fingerDraw` 两个取值 × 三种工具 × 三种设备全表锁进单测。

配套：Touch debug 浮层加了 `finger:draw|scroll` 和 `fingerDraw`，真机上一眼能分清"滑不动"是路由判定还是更下面的问题。

教训：设备能力靠事件去猜，猜错的那一刻用户没有任何线索，而且"还没发生的事"和"不会发生的事"在锁存里长得一模一样。能做成设置项就别做成推断。
