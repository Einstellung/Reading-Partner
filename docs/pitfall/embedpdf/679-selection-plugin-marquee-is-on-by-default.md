# selection 插件默认开框选

现象：PDF 指针模式下从字外面拖一下，页面上出现一个半透明蓝框；松手后框碰到的标注全部被选中，标注编辑器弹在页面上。

原因：`SelectionPluginPackage` 不传配置时 `marquee.enabled` 当作开（`config.marquee?.enabled !== false`），文档一加载就在 pointerMode 上打开框选并显示框。annotation 插件订阅 `onMarqueeEnd`，把与框相交的标注都设成选中，宿主把「有选中」当成打开编辑器的信号（坑 59、60）。

解法：注册时传 `{ marquee: { enabled: false } }`，常量是 `annotation-selection.ts` 的 `SELECTION_CONFIG`，旁边的测试盯着它。阅读器里没有任何功能用框选。
