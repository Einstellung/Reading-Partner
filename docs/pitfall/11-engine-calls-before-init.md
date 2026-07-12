# 引擎方法必须等 onInitialized 之后调

现象：M2 实战踩到。createView 返回后立刻调 `view.setTool(...)`，引擎内部访问 PDFViewerApplication 为 null 直接抛错，整个打开流程中断，文件打不开。

原因：createView 同步返回 view 实例，但 pdf viewer 的初始化是异步的。返回值可用不等于引擎就绪。

解法：所有引擎调用（setTool、navigate、setAnnotations 等）都 gate 在 onInitialized 回调之后。壳里用一个 viewReady 状态控制。
