# 切工具会把「还留着的选中」原样再播一遍，标注编辑器于是在页面中间凭空弹出

现象：iPad 上用笔画完一道下划线，再点手掌（navlock），页面中间弹出标注编辑器（色板、Add a comment、Delete、×），没人点过任何标注。不是每次都弹。

原因：`annotation.onStateChange` 是整份文档状态的流，不是选中变更事件。`setActiveTool` 走同一个 reducer，切工具就会把当前选中原样再发一次——而且是同步发生在宿主自己的 `setTool` 调用里。适配层把每一次非空 emission 当成新选中，重新武装 `EmbedReaderPane` 里那个 150 ms 的兜底定时器；`AnchorProbe` 是 mount-only（同一条标注一直选中就不会重挂），没人取消定时器，150 ms 后按视口中心的兜底位置把弹窗开了。实测：emission 与 `setTool` 同帧，弹窗晚 150 ms，rect 是 2×3 的视口中心兜底框。

间歇性来自切工具那一刻引擎里还有没有选中。画完一笔，插件的 `selectAfterCreate` 默认为真，新标注是选中的；用 × 关掉弹窗只清宿主状态，引擎的选中还活着而且看不见。宿主写标注（同步合并、改颜色）走的是同一条路，一样会弹。

解法：适配层按插件自己的 `selectedUids` **数组身份**判选中有没有真的动——状态变更但选中没动会原样交回同一个数组，任何一次 select dispatch 都会新建一个。不能按 id 比：重选已经选中的那条是真事件（点一下刚关掉编辑器的那条标注要能再打开），按 id 比会被吞掉。宿主再加一道：`setTool` 期间到达的 emission 只更新痕迹列表，不开也不关弹窗。规则在 `src/reading/engine/annotation-selection.ts`，两条都有单测。

`setActiveTool` 不清选中，所以 navlock 下那条标注仍然选着。这是有意留的：坑 46 要保住 navlock 下点一下标注选中它。
