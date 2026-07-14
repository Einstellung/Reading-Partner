# createView 返回的是 wrapper，PDFView 的一半 API 拿不到

现象：想给头部加"实际大小 100%""适应整页""滚动模式"三个按钮，去 `vendor/reader/src/pdf/pdf-view.js` 里翻，`zoomPageHeight()`、`setScrollMode()` 都在。接上去发现 view 实例上根本没有这些方法。

原因：`createView` 返回的不是 PDFView，是 `src/common/view.js` 里的 View 包装层（view-web 入口由 `patches/reader-view-web.patch` 在构建期生成，不在 vendor 里）。PDFView 藏在包装层的私有字段 `_view` 后面，只有包装层显式转发的方法才够得着。转发了 `setSpreadMode`，没转发 `setScrollMode` 和 `zoomPageHeight`。另外包装层的 `zoomBy(delta)` 在 PDF 上直接抛错——PDFView 没有 zoomBy，只有 DOM/EPUB 视图有。

还有一条：PDF 上的 `zoomReset()` 不是回到 100%，它就是适应宽度（`zoomReset() { this.zoomPageWidth(); }`）。引擎里压根没有 setScale，缩放目标只有 page-width / page-fit / auto 三个，"100% 实际大小"这个功能不存在。对应地 `canZoomReset` 的含义是"当前不在 page-width"。

解法：接引擎能力之前先确认方法在包装层上，别在 pdf-view.js 里看见就当有。要用没转发的方法，只能改 `patches/reader-view-web.patch` 加转发再重建 reader。
