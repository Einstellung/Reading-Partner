# 双指缩放期间引擎照样拖选文字；interaction.pause() 是全局的，挡不住单根手指

现象：iPad 上双指 pinch 缩放 PDF，缩放本身正常，但文本层同时被拖出蓝色选区，松手后选区残留、可能弹出划词菜单。

原因：三条读引擎源码才确认的事实。

一，`plugin-zoom` 的 `setupZoomGestures` 把 pinch 挂在 viewport 容器的**原生 touch 事件**上（`touchstart/touchmove/touchend`），自己算 scale 做 CSS transform 预览，完全不查 interaction-manager 的 `isPaused`。所以 pause 引擎、或在 pointer 通道上吞事件，都不会掐掉缩放——touch 和 pointer 是两条独立通道。它提交时调 `requestZoomBy(delta, {vx, vy})`，锚点在 `computeScrollForZoomChange` 里按**提交那一刻**的 `scrollLeft/scrollTop` 解析，所以缩放期间宿主自己改 scroll（双指平移）不会让缩放跑偏。

二，`plugin-selection` 的文字选择 handler 用 `registerAlways` 注册到每一页，内部只有一个 anchor 且**不区分 pointerId**：第一根手指 pointerdown 落在文字上就设 anchor，此后任何指针 move 超过 3px 就开始拖选。旧代码在第二根手指落下时 `resume()` 把引擎原样交还，pinch 的两根手指于是一路刷选区。anchor 只在 pointerup 复位，所以吞掉 pointerup 会留下悬空 anchor（笔 hover 的 move 能凭空起选）。

三，`interaction.pause()` 是**全局**开关（`createPointerProvider.handleEvent` 一律早退），拦不住"只拦这一根手指"。笔在写字时手掌落下若走 pause，笔画会一起断；annotation 的 handler 同样不看 pointerId，任何指针的 pointerup 都会结束当前笔画。

解法：多指、手掌、笔占用期间不再用 pause，改在 viewport 容器 capture 阶段对单个指针 `stopPropagation()`——页 div 在下游，吞了就到不了引擎，而 touch 通道不受影响，缩放照常。手指数语义收敛成规则表（`src/reading/engine/touch-routing.ts`，含单测）：1 指走原有路由；2 指 = 缩放 + 质心平移，全程禁选禁画，latch 到所有手指抬起（2→3→2 属同一次手势，不重启）；≥3 指全吞。笔一落下就取消进行中的手指滚动和惯性，并把已在屏上的手指标死到全部抬起。单指路径继续用 pause（标注工具 pointerdown 即 pause 那条不能动，见坑 37）。

两个必须守的不变量：引擎见过 pointerdown 的那根手指必须收到 pointerup，否则选择 handler 留悬空 anchor；唯一例外是笔正在写字时，宁可留悬空 anchor 也不能把手掌的 pointerup 漏给引擎断掉笔画。

## 补：`setPointerCapture` 也会漏掉 pointerup，每一次滚动都漏

现象：iPad 上滑动翻页，偶尔整页变蓝像被全选，末尾还有一道像光标的细条。

原因：上面那条不变量只写了"别吞 pointerup"，漏了另一条同样切断投递的路。滚动 commit 时路由器对 viewport 调 `setPointerCapture`，此后这根指针的所有事件都被重定向到 viewport，页 div 再也收不到——引擎的 pointerup 不是被吞掉，是压根没派发过去。于是每一次滑动结束，那一页的选择 handler 都留着 `anchorGlyph`/`anchorPos`（`hasTextAnchor` 一直是 true），有时还留下 plugin 级的 `selecting = true`。

留着的 anchor 是活的：handler 的 `onPointerMove` 只要看到 `anchorGlyph` 且 `dragStarted` 为假，就拿当前点和**上一次滑动**的 anchorPos 比距离，超过 `minDragDistance`（默认 3 页面单位，约 4 css px）直接 `onBegin(旧 anchor)` + `onUpdate(当前字)`——不需要任何 pointerdown。中间隔了几屏滚动，选区就从上次起手的那个词一直拉到指针所在处，整页甚至跨页全蓝；`rectsWithinSlice` 在断行处切出的窄条看着就是个文字光标。Chromium 实测：三次普通手指滑动之后，一个不按键的两像素 mousemove 就凭空选出 639 个字符、44779 px² 的蓝。iPad 上同样的裸 move 来自悬停的 Pencil，或任何走到引擎的指针移动。

`selection.clear()` 修不了：它只清 plugin 的 `selecting`/`anchor`/rects，清不掉每页 handler 闭包里的那份 anchor。`shouldClearGestureSelection` 也够不着——它看的是 `getBoundingRects().length`，而"只有 anchor、还没画出 rects"的状态是隐形的。

解法：路由器接管手势的那一刻，给引擎补发一个合成 `pointerup`（`dispatchEvent` 到 pointerdown 当时的 target），让它自己走 `onPointerUp` → `onEnd` + `reset`。三个必须对的细节：一，必须在 `pause()` **之前**发，暂停中的引擎会原样丢掉；二，只给引擎真听见过 down 的指针发（annotate 工具 pauseAtDown、落在惯性上的 takeover，引擎都没听见 down，不欠），规则在 `vertical-gesture.ts` 的 `engineHeardDown` 和 `touch-routing.ts` 的 `shouldHandEngineTheUp`；三，合成事件会穿回路由器自己的监听器，要用一个 `synthesizing` 标志挡住，并在 viewport 上冒泡阶段截停，别让外面当成真的抬手。

附：手掌抑制按 `PointerEvent.width/height` 判定，但 iOS WKWebView 是否真的给出接触面积没有实测过（很可能是常值）。阈值是常量（`PALM_CONTACT_PX` / `PALM_CONTACT_PX_WITH_PEN`），几何为 0 或 1×1 时一律不判掌。真机数据用阅读器 More 菜单里的 Touch debug 开关采：视口左下角实时显示触点数、每个触点的 pointerType 和 width×height、以及本次会话的峰值。
