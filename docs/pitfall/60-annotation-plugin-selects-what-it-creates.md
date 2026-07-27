# 画完一笔，插件把新标注设成选中，标注编辑器就自己弹出来

现象：用下划线笔或高亮笔划一道，笔一抬，色板 + Add a comment + Delete 的标注编辑器就浮在刚划的地方上面，挡住页面。没人点过任何标注。新画的那条同时是选中状态：带选中框，页面被选中活动占着。

原因：标注插件的 `selectAfterCreate` 运行期默认是 true（`manifest.defaultConfig` 里写着，合并工具配置时也是 `?? true`）。它自己的类型声明注释却写成 "When true (default false)"——照类型文档读会得出反的结论，只有跑起来才知道。两条创建路径各自读这个开关：文字标记（highlight / underline，走 selectionHandler）和指针类工具（ink，走 onCommit），创建之后都紧跟一次 `selectAnnotation`。宿主把「有选中」当成打开标注编辑器的唯一信号（`EmbedReaderPane` 的 `onSelectAnnotation` 武装 150 ms 兜底定时器，`onAnnotationAnchor` 精确定位），于是每一笔都开一次编辑器。

解法：注册插件时显式关掉，`selectAfterCreate: false`，常量和理由在 `src/reading/engine/annotation-selection.ts`。`CREATE_ANNOTATION` 那条 reducer 分支不碰 `selectedUids`，所以关掉之后一次创建只发出「选中数组原样不变」的状态流，`selectionChanged` 判成没动，宿主什么也收不到。没有东西依赖「刚创建的那条是选中的」：新标注的 id 从创建事件（`onSaveAnnotations`）来，AI 笔的会话也是在那里开的；唯一的可见变化是刚画完的那条不再是痕迹列表里的高亮行，而那正是「什么都没选中」该有的样子。

同族的一条邻居行为（实测，尚未修）：一条标注被选中后，插件把它的图形设成 `pointerEvents: "none"`（事件归选中框），而「点空白处取消选中」只有在 pointerdown 正好落到标注层自己身上时才发生——正文区被文字选区层盖着，点不到。于是「点开编辑器 → 关掉 → 再点同一条」在正文区里点不出来，要先在文字块以外的空白处点一下。真正的修法是宿主关闭编辑器时一并让引擎取消选中；只清宿主状态就会留下一条看不见的选中和一条点不动的标注（坑 59 的另一面）。
