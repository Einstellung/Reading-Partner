# 手掌锁下用 Pencil 滑动，页面滚得好好的，笔过之处照样拖出蓝色选区

现象：点亮手掌（navlock）后用 Apple Pencil 上下滑动，滚动完全正常，但笔尖扫过的那个词会被选中，留下一块蓝色。

原因：navlock 下笔走 contact 路径，滚动由我们自己驱动，但 `planPointer` 只给 annotate 工具设了 `pauseAtDown`，navlock 沿用了「等手势 commit 再接管」那套。于是笔的 pointerdown 和 commit 之前的几个 pointermove 都放行给了引擎。引擎不读 `pointerType`，选区 handler 只要一个 down 加一个 move 就开始拖选，超过它自己的几像素阈值就成型。commit 时我们做的 `dropSelection` 清的是那一刻已经存在的选区，晚一步成型的清不掉。

不能用 `interaction.pause()` 解决：pause 是全局的（坑 38），而且一旦在 pointerdown 就 pause，navlock 下的 tap 也一起没了——点一下消气泡、点标注选中它，这两个行为要留着。

解法：给 `PointerPlan` 加 `engineMayDrag`，navlock 下为 false。路由器逐指针 `stopPropagation` 掉这类指针的 **pointermove**，down 和 up 照旧放行。引擎拿到一个原地按下又抬起的指针，产生不了选区，tap 的语义原样保留。手势结束时再按 `shouldClearGestureSelection` 扫一次兜底（手势开始前就有的选区不动）。

规则本身在 `src/reading/engine/gesture/touch-routing.ts` 的 `planPointer`，逐指针拦截在 `src/reading/engine/gesture/attach-touch.ts` 的 `onMove`。
