# 引擎方法必须等 onInitialized 之后调

> zotero 引擎时代的坑，`PDFViewerApplication` 已不存在。规矩仍在：适配层只在 `onReady` 里交出 handle，App 用 `viewReady` 闸住所有引擎调用。

现象：M2 实战踩到。createView 返回后立刻调 `view.setTool(...)`，引擎内部访问 PDFViewerApplication 为 null 直接抛错，整个打开流程中断，文件打不开。

原因：createView 同步返回 view 实例，但 pdf viewer 的初始化是异步的。返回值可用不等于引擎就绪。

解法：所有引擎调用（setTool、navigate、setAnnotations 等）都 gate 在 onInitialized 回调之后。壳里用一个 viewReady 状态控制。
