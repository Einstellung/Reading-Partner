# 双指缩放期间引擎照样拖选文字；interaction.pause() 是全局的，挡不住单根手指

现象：iPad 上双指 pinch 缩放 PDF，缩放本身正常，但文本层同时被拖出蓝色选区，松手后选区残留、可能弹出划词菜单。

原因：三条读引擎源码才确认的事实。

一，`plugin-zoom` 的 `setupZoomGestures` 把 pinch 挂在 viewport 容器的**原生 touch 事件**上（`touchstart/touchmove/touchend`），自己算 scale 做 CSS transform 预览，完全不查 interaction-manager 的 `isPaused`。所以 pause 引擎、或在 pointer 通道上吞事件，都不会掐掉缩放——touch 和 pointer 是两条独立通道。它提交时调 `requestZoomBy(delta, {vx, vy})`，锚点在 `computeScrollForZoomChange` 里按**提交那一刻**的 `scrollLeft/scrollTop` 解析，所以缩放期间宿主自己改 scroll（双指平移）不会让缩放跑偏。

二，`plugin-selection` 的文字选择 handler 用 `registerAlways` 注册到每一页，内部只有一个 anchor 且**不区分 pointerId**：第一根手指 pointerdown 落在文字上就设 anchor，此后任何指针 move 超过 3px 就开始拖选。旧代码在第二根手指落下时 `resume()` 把引擎原样交还，pinch 的两根手指于是一路刷选区。anchor 只在 pointerup 复位，所以吞掉 pointerup 会留下悬空 anchor（笔 hover 的 move 能凭空起选）。

三，`interaction.pause()` 是**全局**开关（`createPointerProvider.handleEvent` 一律早退），拦不住"只拦这一根手指"。笔在写字时手掌落下若走 pause，笔画会一起断；annotation 的 handler 同样不看 pointerId，任何指针的 pointerup 都会结束当前笔画。

解法：多指、手掌、笔占用期间不再用 pause，改在 viewport 容器 capture 阶段对单个指针 `stopPropagation()`——页 div 在下游，吞了就到不了引擎，而 touch 通道不受影响，缩放照常。手指数语义收敛成规则表（`src/reading/engine/touch-routing.ts`，含单测）：1 指走原有路由；2 指 = 缩放 + 质心平移，全程禁选禁画，latch 到所有手指抬起（2→3→2 属同一次手势，不重启）；≥3 指全吞。笔一落下就取消进行中的手指滚动和惯性，并把已在屏上的手指标死到全部抬起。单指路径继续用 pause（标注工具 pointerdown 即 pause 那条不能动，见坑 37）。

两个必须守的不变量：引擎见过 pointerdown 的那根手指必须收到 pointerup，否则选择 handler 留悬空 anchor；唯一例外是笔正在写字时，宁可留悬空 anchor 也不能把手掌的 pointerup 漏给引擎断掉笔画。

附：手掌抑制按 `PointerEvent.width/height` 判定，但 iOS WKWebView 是否真的给出接触面积没有实测过（很可能是常值）。阈值是常量（`PALM_CONTACT_PX` / `PALM_CONTACT_PX_WITH_PEN`），几何为 0 或 1×1 时一律不判掌。真机数据用阅读器 More 菜单里的 Touch debug 开关采：视口左下角实时显示触点数、每个触点的 pointerType 和 width×height、以及本次会话的峰值。
