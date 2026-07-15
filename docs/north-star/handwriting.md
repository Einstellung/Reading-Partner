# 手写：用 Pencil 在 PDF 上写字画画

## 愿景

在 PDF 上直接用 Apple Pencil 写批注、画圈、划重点、在空白处推公式。橡皮擦掉。笔迹和现有的高亮/下划线一样，是一条线索，进线索列表，AI 也能看见。

## 为什么现在不做

引擎那半是现成的，壳这半接上去只要半天，但真正决定手写好不好用的三件事全都在 iPad 上，而 iPad 版还没构建出来（M-iPad 卡在 Apple 开发者账号）。桌面上鼠标手写没人用，数位板是小众。现在做，等于把压感和防误触盲写一遍，到真机上再重做。

所以：等 M-iPad 落地，能在真机上调，再一次做完。

## 将来做时已知的事实

引擎已实现（`vendor/reader/src/pdf/pdf-view.js`，裸 `createView` 模式下可用，不依赖 Zotero 自己的界面）：

- `ink` 工具：pointerdown 起一条 `ink` 标注，路径点累加进 `position.paths`，抬笔存盘（pdf-view.js:2453、2751）。
- `eraser` 工具：`eraseInk(x, y, size, annotations)` 按路径擦（pdf-view.js:2777）。
- 笔宽档位表 `INK_ANNOTATION_WIDTH_STEPS`，0.2 到 25（`src/common/defines.js`）。
- ink 标注可拖动、可选中，走的是和其他标注一样的通路。

壳要做的：`Tool` 类型加 `size` 字段，PenToolbar 加笔和橡皮两个按钮加笔宽选择，`setTool({type:'ink', color, size})`。标注的存取、渲染、删除全部复用现有通路。

引擎没管、要我们自己解决的三件：

1. **没有压感。** 引擎给整条笔画一个固定 `width`（pdf-view.js:2759 `width: this._tool.size`），不读 `event.pressure`。Pencil 用力画不会变粗。要压感得改 `patches/reader-view-web.patch`，把 paths 从点序列改成带宽度的点序列——这会改标注的数据格式，且偏离上游。

2. **手掌会画上去。** `getActionAtPosition` 里 ink 是无条件触发的，不看 `pointerType`（pdf-view.js:2453，在 mouse/pen 的判断之前就返回了）。iPad 上手指一碰就画，而不是滚动。防误触要我们在 pdf iframe 里拦：捕获阶段拦掉非 `pen` 的 pointer 事件（引擎收不到，浏览器照常滚动）。壳里已经有往这个 iframe 挂捕获监听的先例（App.tsx 的 `installPenUpAnchor`）。

3. **WebKitGTK 上会卡。** 拖选高亮的延迟已经踩过（pitfall 12），手写是同一个问题。iPad 的 WKWebView 应该没这毛病，但这是猜测，没验过。

另外：ink 标注的 paths 是点数组，写多了 `annotations-<hash>.json` 会涨。引擎有 `ANNOTATION_POSITION_MAX_SIZE = 65000` 的上限，超了怎么处理没查。做的时候要看一眼（参考 pitfall 07，image 标注内联 base64 撑爆 JSON 的教训）。
