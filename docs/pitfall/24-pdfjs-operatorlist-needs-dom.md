# pdf.js getOperatorList / render 需要 DOM，bun 测试跑不了

现象：全文提取用 `page.getTextContent()` 在 bun（`bun test`）里跑得好好的，但图片索引要 `page.getOperatorList()` 拿图元变换，一调就在 pdf.js 内部炸 `ReferenceError: DOMMatrix is not defined`（`SCALE_MATRIX = new DOMMatrix()`）。给主线程 `globalThis.DOMMatrix` 打桩也没用——报错发生在 pdf.js 的（伪）worker 模块作用域里，主线程的桩够不到。

原因：`getOperatorList` 和 `page.render` 走的是 pdf.js 的绘制路径，依赖 `DOMMatrix`/`Path2D`/canvas，这些只有浏览器（webview）里才有。`getTextContent` 不碰绘制，所以能在 node/bun 里裸跑。

解法：把图片索引的提取切成两半，跟全文提取同一套路：

- 纯函数（CTM 栈算图元 bbox、图注正则配对、配对合并）只吃普通的 operator/text 数据结构，headless，`bun test` 覆盖（`tests/figures/extract.test.ts` 用合成算子数据）。
- 引擎路径 `extractFiguresFromDocument`（真调 `getOperatorList`）只在 webview 里跑，测试不覆盖，靠真机验证。

配套：`demo.pdf` 那种"整本真 PDF 抽图"的集成测试在 bun 里做不了（`getOperatorList` 就是过不去），别写，写了也只能 skip。真 PDF 里图元算子每个 `Do` 都被 `q`/`Q`（save/restore）包住，构造合成测试数据时别忘了这层，否则第二张图的变换会叠在第一张上。

补充（矢量图 bbox，pdfjs 4.10.38）：`OPS.constructPath` 的参数打包成 `[subOpCodes[], flatArgs[], minMax]`。`minMax` 只在 `moveTo`/`lineTo`/`rectangle` 分支更新，贝塞尔（`curveTo`/`curveTo2`/`curveTo3`）走 default 分支不进 minMax——纯曲线路径的 minMax 会是 `[Infinity,…]` 或残缺。别用 minMax，直接解 `flatArgs`：verb 消耗的参数数为 rectangle 4（x,y,w,h，不是两个点）、moveTo/lineTo 2、curveTo 6、curveTo2/curveTo3 4、closePath 0，按顺序游标推进。路径只在后续的 fill/stroke/eoFill 等 paint 算子才算"画上去"，clip/eoClip/endPath 只裁剪不入框。
