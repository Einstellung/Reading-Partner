# 程序化选中不弹浮窗

现象：调 `selectAnnotations([id])` 或 `navigate({annotationID})`，标注被选中并滚动到位，但 onSetAnnotationPopup 不带 rect 触发，反而发一次无参（关闭）。

原因：源码里标注浮窗只在真实点击路径上打开，程序化选中不走那条路。

解法：壳里"点痕迹列表条目 → 弹窗"这类交互，要么模拟真实点击，要么监听 onSelectAnnotations 后自己定位（rect 可从标注的 position 换算）。
