# iPad 上 web 层做不了掌抑制，也不需要做：笔手互斥且不可关闭，接触面积拿不到

现象：按接触面积做掌抑制（`PointerEvent.width/height` 超过阈值判为手掌）在 iPad 上全错。一根正常手指按下，探针显示 palm 1 / finger 0——每根手指都被判成掌。连带更严重的后果：双指缩放时两根手指都判掌，手指数永远到不了 2，pinch 规则整套不触发，"缩放期间禁选"形同虚设，真机上缩放照样拖出蓝色选区。五指按下和手肘压屏则相反，探针显示 finger 0 / palm 0，事件根本没到网页。

原因：两件事，查规范和 Apple 论坛（Apple Developer Forums thread 773213、W3C Pointer Events、MDN）才确认。

一，iPadOS 的 Safari/WKWebView 里笔和触摸互斥：Pencil 按下时系统不把手指的 touch 事件派发给网页，反之手指在屏上时 Pencil 也被挡。规范承认这就是系统级的 palm rejection，并明说 "it is not possible for authors to suppress this behavior"。掌抑制系统已经做完了，网页既看不到手掌，也关不掉这个行为。大面积接触（手肘、五指）同理，被系统当误触或系统手势吃掉。

二，iOS Safari 不实现 `Touch.radiusX/radiusY`；`PointerEvent.width/height` 在硬件不上报接触几何时按规范返回 1，iOS 给的就是没有区分能力的值。阈值定多少都没用。

解法：不要在 web 层写掌抑制。`isPalmContact` 那套（面积阈值、常量、单测、router 里的 palms 集合）已全部删除，不留"以后再打开"的开关。手指规则只按手指数走（1 单指 / 2 pinch / ≥3 吞掉），见坑 38。

笔优先的 `fingerLockAfterPen` 留着：iPadOS 上大概率永远不触发（笔按下时手指事件根本不来），但它覆盖"手指滚动进行中笔落下"这个系统仍可能派发的边界，且其他触控笔平台没有这条互斥规则。

探针（More 菜单 Touch debug）仍然显示每个触点的 width × height，那只是原始诊断数值，不能拿来判掌。

待验：手先撑在屏上、再用笔落下，笔是否会被系统挡住。
