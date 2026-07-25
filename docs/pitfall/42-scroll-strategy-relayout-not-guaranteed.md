# 切换 scroll strategy 不保证重排，跟在后面的 requestZoom 也可能一声不响

现象：从 paged（横向页带）切回 vertical 后，页面可能仍然是横排的：纵向滑动没有可滚的高度（`scrollHeight ≈ clientHeight`），横向一动就滑出下一页。插件状态说 vertical，DOM 还是 strip。

原因：两条本以为兜底的路径都可能静默不做事。一，`plugin-scroll` 的 `setScrollStrategyForDocument` 换完 strategy 会调 `refreshDocumentLayout`，而后者开头就是 `if (!coreDoc || !docState || coreDoc.status !== "loaded") return;`——文档那一刻不是 loaded 就直接返回，不报错、不重排、之后也没有别的事件补做。二，紧跟着的 `requestZoom` 通常会触发一次 zoom change 顺带重排，但**竖屏 iPad 上 fit-page 和 fit-width 的数值可能相同**（实测 820×1180 视口、612×792 的页：两者都是 1.339），缩放值没变就没有 change 事件，也就没有这次重排。两条一起哑掉，布局就卡在旧模式。

解法：切换布局不要当成一次性命令。`setLayout` 把该模式的每一项（scroll axis / zoom / touch-action / 手势机状态 / fit-page 基准）无条件全量应用，不做 `mode === layout` 的提前返回，并在下一帧对 axis 和 zoom 再断言一次（`layout !== mode` 时放弃，让更新的那次切换赢）。设置项和"进出必须对称"的证明放在 `src/reading/engine/layout-modes.ts` 的纯函数里，单测覆盖来回切换回到初始。

顺带：布局切换必须把触摸路由器在飞的东西一起丢掉（惯性、长按计时器、paged 状态机相位、橡皮筋 transform、pointer capture、`interaction.pause()`）。实测切换发生在手指没抬起时，引擎的 pause 会一直挂到下一次手势才被解开，中间选字和标注全是死的。
