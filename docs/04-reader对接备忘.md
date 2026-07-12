# reader 对接备忘

壳走 `createView`（引擎只做渲染加批注的画布，工具栏侧栏全自建），不走 `createReader`。本文是实测出来的对接手册：怎么构建出能嵌的产物、怎么起、回调收到什么、有哪些坑。基于 reader commit `8cb2963`，只测了 PDF。

## view-web 构建变体

webpack 里只有 ios / android / view-dev 三个 View 构建，没有生产用的 web-View。加一个 `view-web` 变体，改动见 `patches/reader-view-web.patch`（对应 commit `8cb2963`），两处：`webpack.config.js` 让 view-web 复用 View 的 pdf 拷贝逻辑并加进 `module.exports`；新增 `src/index.view-web.js`，仿 `index.web.js` 只暴露 `window.createView`，不自动加载 demo。

构建（先跑过一次 `npm run build` 或 `npm run view-dev`，产出 `build/mobile/pdf`）：

```
NODE_OPTIONS=--openssl-legacy-provider npx webpack --config-name view-web
```

产物在 `build/view-web/`：`view.js`（4.3M，UMD，定义 `window.createView`）、`view.css`（616B）、`903.view.js`（按需 chunk）、`pdf/`（从 `build/mobile` 拷来的 pdf.js 资产）。`view.css` 只有 616B 是因为 EPUB/snapshot 视图的样式用 raw-loader 内联进了 `view.js`，PDF 的样式在 `pdf/web/viewer.css`。当前是 production 模式非压缩；壳的构建脚本开 minify 即压缩。

## 调用模板

宿主页要有一个 `<div id="view">` 挂载点，先加载 `view.js` 再调 `createView`。必需的 options 只有 `type` 和 `data.buf`（自己 fetch 拿字节，不需要 `data.url`）。

```js
const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
const view = window.createView({
  type: 'pdf',                    // pdf | epub | snapshot
  data: { buf },
  annotations: [...],             // 已有标注，空数组也行
  authorName: 'Reading-Partner',  // 新建标注的 authorName
  // container 默认取 #view，也可在此传

  onInitialized: () => {},        // 就绪信号，用这个（见坑）
  onSaveAnnotations: (anns) => {}, // 创建/修改标注
  onDeleteAnnotations: (ids) => {},
  onSelectAnnotations: (ids) => {},
  onSetSelectionPopup: (params) => {},   // 划词浮窗
  onSetAnnotationPopup: (params) => {},  // 点已有标注的浮窗
  onChangeViewState: (state) => {},      // 阅读位置，持久化用
  onChangeViewStats: (stats) => {},      // UI 状态，画导航/进度用
  onSetOutline: (outline) => {},
  onSetPageLabels: (labels) => {},
  onSetThumbnails: (thumbs) => {},
  onRequestPassword: () => {},
  onOpenLink: (url) => {},
  onFindResult: (result) => {},
});
```

## 回调契约

实参样例都是真跑抓的。坐标有两套：`position.rects` 是文档坐标系（PDF pt），`rect` 是视口坐标（用于定位浮窗），都是 `[left, top, right, bottom]`。

`onSaveAnnotations(annotations)` — 标注被创建或修改时触发，参数是标注数组：

```json
{
  "type": "highlight", "color": "#ffd400",
  "sortIndex": "00000|000500|00100", "pageLabel": "1",
  "position": { "pageIndex": 0, "rects": [[100, 650, 300, 662]] },
  "text": "选中的原文", "comment": "", "tags": [],
  "id": "QLCS27GS", "dateCreated": "2026-07-12T06:34:25.037Z",
  "dateModified": "2026-07-12T06:34:25.037Z",
  "authorName": "Reading-Partner", "isAuthorNameAuthoritative": true
}
```

用 highlight 工具真实拖选时，`position.rects` 是从文本几何算出的多矩形，`text` 是提取的原文。reader 不落盘，onSaveAnnotations 只把对象交给壳，持久化是壳的责任。

`onSetSelectionPopup(params)` — pointer 工具下拖选文字触发，关闭时传无参。`annotation` 是预生成的候选高亮（无 id，用户点"高亮"才真正创建）：

```json
{
  "rect": [214.2, 57.6, 1072.4, 127.0],
  "annotation": {
    "type": "highlight", "sortIndex": "...", "pageLabel": "1",
    "position": { "pageIndex": 0, "rects": [[95.6, 592.1, 519.1, 600.2]] },
    "text": "选中的原文"
  }
}
```

EPUB/snapshot 视图还多带 `preferLeft` / `preferTop` 两个定位提示。

`onSetAnnotationPopup(params)` — 点击一个已渲染的标注触发，关闭时传无参。同样是 `{rect, annotation}`，但 `annotation` 是已保存的完整对象（带 id）：

```json
{
  "rect": [214.2, 57.6, 757.8, 74.1],
  "annotation": { "type": "highlight", "id": "ENE6ZJ34", "position": {...}, "text": "...", ... }
}
```

`onChangeViewState(state)` — 阅读位置变化，用于持久化和还原：

```json
{ "pageIndex": 0, "scale": "page-width", "top": 629, "left": -10, "scrollMode": 0, "spreadMode": 0 }
```

`onChangeViewStats(stats)` — UI 状态，画导航按钮和进度用：

```json
{
  "pageIndex": 0, "pageLabel": "1", "pagesCount": 14, "outlinePath": null, "canCopy": 0,
  "canZoomOut": true, "canZoomIn": true, "canZoomReset": false,
  "canNavigateBack": false, "canNavigateForward": false,
  "canNavigateToFirstPage": false, "canNavigateToLastPage": true,
  "canNavigateToPreviousPage": false, "canNavigateToNextPage": true,
  "zoomAutoEnabled": false, "zoomPageWidthEnabled": true, "zoomPageHeightEnabled": false,
  "scrollMode": 0, "spreadMode": 0
}
```

## 自定义字段

AI 星标、线程 ID 这类元数据可以直接挂在标注对象上，不需要宿主侧的映射表。实测 `aiThreadId` 走完整 round-trip（创建 → onSaveAnnotations 带出 → 壳持久化 → 原样喂回 createView → 改 comment → 再 save）全程不丢。原理是 AnnotationManager 不做字段白名单：加载持引用，保存 `JSON.parse(JSON.stringify())` 深拷贝，更新走 `{...existing, ...incoming}` 浅合并，未知字段一路透传。前提是壳自己落盘时别过滤掉。只测了 PDF，EPUB/snapshot 的更新分支是顶层 spread 合并，同样保留但未实测。

## 导航与视图方法

`view` 实例上：`navigate({ pageIndex })` 或 `navigate({ annotationID })`、`navigateBack()`、`navigateForward()`；`find(params)` / `findNext()` / `findPrevious()`；`zoomIn/zoomOut/zoomReset`；`setFlowMode` / `setSpreadMode`；`setTheme` / `setColorScheme`；`setTool(tool)` / `setAnnotations` / `unsetAnnotations` / `selectAnnotations(ids)`。

## 坑

全部移至 [pitfall/](./pitfall/)（一坑一文件，含现象/原因/解法）。与本文相关的：01 pdf 相对路径、02 sumPrecise polyfill、03 initializedPromise、04 程序化选中不弹窗、05 onSelectAnnotations 回喂、06 宿主改删标注 API、07 image 标注膨胀、08 构建期网络依赖、10 跨 realm Uint8Array。

---

*讨论日期：2026-07-12*
