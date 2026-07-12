# 笔工具划完不给浮窗坐标

现象：M4 实测。highlight/underline 笔划完的那一刻，引擎只触发 onSaveAnnotations（带 annotation 数据），onSetSelectionPopup 和 onSetAnnotationPopup 都不带坐标触发——"刚划完立刻在划线旁弹气泡"拿不到锚点。

原因：笔工具的创建路径不走浮窗逻辑（这正是它不弹划词浮窗的另一面）；浮窗坐标只在 pointer 工具的选区和真实点击已有标注时给。

解法：iframe 同源，在 pdf iframe 的 contentDocument 上挂 pointerup 监听（capture），记录最后一次抬笔的 clientX/Y，加宿主 iframe 偏移作气泡锚点。注意 pdf iframe 是引擎动态建的，要在 onInitialized 后安装监听，未就绪则轮询重试。
