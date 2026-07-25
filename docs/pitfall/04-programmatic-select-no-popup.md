# 程序化选中不弹浮窗

> zotero 引擎时代的坑，EmbedPDF 下结论反过来了：适配层的 `selectAnnotation` 会经 `annotation.onStateChange` 派出 `onSelectAnnotation`，`EmbedReaderPane` 照常开弹窗（精确锚点或 150ms 兜底）。App.tsx 里"程序化选中不弹窗，正好适合痕迹列表跳转"那条注释因此已不成立。

现象：调 `selectAnnotations([id])` 或 `navigate({annotationID})`，标注被选中并滚动到位，但 onSetAnnotationPopup 不带 rect 触发，反而发一次无参（关闭）。

原因：源码里标注浮窗只在真实点击路径上打开，程序化选中不走那条路。

解法：壳里"点痕迹列表条目 → 弹窗"这类交互，要么模拟真实点击，要么监听 onSelectAnnotations 后自己定位（rect 可从标注的 position 换算）。
