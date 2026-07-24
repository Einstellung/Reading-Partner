# EmbedPDF 每页 div 在所有模式下都是 touch-action:none，页面上原生触摸滚动不可能

现象：iPad 上手指在页面主体拖动，标注工具激活时画线；即使切回手掌（pointer）工具，手指在页面上也不能原生滚动，反而拖出文字选区。CSS 又分不清 Apple Pencil 和手指。

原因：`plugin-interaction-manager/dist/react/index.js` 的 `createPointerProvider` 给 `PagePointerProvider` 渲染的**每页整尺寸 div** 设 `element.style.touchAction = wantsRawTouch !== false ? "none" : ""`。默认 `pointerMode` 和所有标注 mode 都没传 `wantsRawTouch`（`undefined !== false` → true），所以**每种模式**（含手掌）页 div 都是 `touch-action:none`。一旦触摸落在页面上，浏览器不产生原生滚动/缩放。绘制连续 move 靠 `touch-action:none` + handler 里的 `setPointerCapture`；现代浏览器走 pointer 事件通道，引擎不读 `pointerType`，笔手一律画。`interaction.pause()` 只让 `handleEvent` 早退（不派发给 mode handler），不改 touch-action、不影响 `plugin-zoom` 的双指缩放（缩放在 viewport 容器上独立挂原生 touch，不查 isPaused）。

解法：笔手路由必须在 JS 层、按 `pointerType` 逐事件做，拦在 viewport 滚动容器的 capture 阶段（早于页 div 的 bubble handler）。判定为"该滚动的 touch"时 `interaction.pause()` + `setPointerCapture` 到容器 + `preventDefault` + 自己驱动 `scrollTop`（原生滚动被 touch-action:none 挡死，必须自驱动，可选加惯性）；判定为"该画的 pointer"（pen/mouse，或无笔设备的 touch）直接放行到引擎。pen/mouse 一律不拦（桌面零回归）。会话级 `penSeen` 锁存（任一 pointerType==="pen" 事件置真）决定"有笔时手指只滚、无笔设备手指画"。判定表抽成纯函数单测（`src/reader-embedpdf/touch-routing.ts`），接线在 `EmbedPdfView.tsx` 的 `TouchInputRouter`。不要试图用 `wantsRawTouch:false` 覆盖 mode 把页 div 放回可滚：那样 touch-action 变 `""`（auto）会放开浏览器原生 pinch-zoom，在 iPad WKWebView 里和引擎缩放打架。

附带一个开发环境坑：`vite.config.ts` 的 `server.watch.ignored` 含 `**/.claude/**`（本意是别让 agent worktree 的文件变动打断用户主 checkout 的 dev）。在 `.claude/worktrees/` 里跑 `bun run dev` 时，vite 监听不到自己源码的改动，一直服务旧转换缓存——改完代码要重启 dev server 才生效。
