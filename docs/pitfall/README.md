# 坑清单

踩过一次才知道的意外行为。一坑一文件，格式：现象 / 原因 / 解法。踩到新坑就在这里加一个文件，并把文件名加进下面的索引。

标 historical 的是 zotero/reader 引擎时代的坑（引擎已换成 EmbedPDF，文件留作历史）。

- [01-pdf-relative-path](./01-pdf-relative-path.md) — 宿主页必须和 pdf/ 目录同级（historical，zotero 引擎）
- [02-math-sumprecise-polyfill](./02-math-sumprecise-polyfill.md) — mobile pdf.js 裸调 Math.sumPrecise（historical，zotero 引擎）
- [03-initialized-promise](./03-initialized-promise.md) — 顶层 initializedPromise 永不 resolve（historical，zotero 引擎）
- [04-programmatic-select-no-popup](./04-programmatic-select-no-popup.md) — 程序化选中不弹浮窗（historical，zotero 引擎）
- [05-onselect-echo-required](./05-onselect-echo-required.md) — 点击弹窗要求宿主回喂 selectAnnotations（historical，zotero 引擎）
- [06-host-annotation-update-api](./06-host-annotation-update-api.md) — 宿主改/删标注的正确 API（historical，zotero 引擎）
- [07-image-annotation-base64](./07-image-annotation-base64.md) — image 标注内联截图导致 JSON 膨胀（historical，zotero 引擎）
- [08-build-network-dependency](./08-build-network-dependency.md) — reader 构建期要联网下语言文件（historical，zotero 引擎）
- [09-appdata-glob-capability](./09-appdata-glob-capability.md) — Tauri 权限 glob 不匹配目录本身
- [10-cross-realm-uint8array](./10-cross-realm-uint8array.md) — iframe 跨 realm 的 Uint8Array instanceof（historical，zotero 引擎）
- [11-engine-calls-before-init](./11-engine-calls-before-init.md) — 引擎方法必须等 onInitialized 之后调（historical，zotero 引擎）
- [12-webkitgtk-drag-latency](./12-webkitgtk-drag-latency.md) — WebKitGTK 拖选高亮时选区滞后于鼠标（historical，zotero 引擎的 pdf.js DOM 渲染路径）
- [13-pen-stroke-no-popup-coords](./13-pen-stroke-no-popup-coords.md) — 笔工具划完不给浮窗坐标,气泡锚点靠 pointerup 兜底（historical，zotero 引擎）
- [14-dev-build-oomd-session-kill](./14-dev-build-oomd-session-kill.md) — 全量 Rust 编译触发 systemd-oomd 杀整个桌面会话
- [15-plugin-http-forced-origin](./15-plugin-http-forced-origin.md) — Tauri http 插件强制补 Origin,Anthropic 视其为 CORS 请求
- [16-webkitgtk-clipboard-image](./16-webkitgtk-clipboard-image.md) — WebKitGTK 的 DOM paste 事件不带图片,贴图要从 Rust 读剪贴板
- [17-view-wrapper-hides-pdfview-api](./17-view-wrapper-hides-pdfview-api.md) — createView 返回包装层,PDFView 的一半方法没转发出来;zoomReset 是适应宽度不是 100%（historical，zotero 引擎）
- [18-embedpdf-load-hangs-progress-zero](./18-embedpdf-load-hangs-progress-zero.md) — EmbedPDF 文档加载静默卡 progress 0,需跨源隔离头 + 直连引擎(worker:false)
- [19-embedpdf-initialdocuments-hang](./19-embedpdf-initialdocuments-hang.md) — EmbedPDF initialDocuments 卡 loading,改成 init 后显式 openDocumentBuffer
- [20-embedpdf-renderlayer-eats-pointer](./20-embedpdf-renderlayer-eats-pointer.md) — EmbedPDF RenderLayer 的 img 吃指针事件,划词失效,需 pointerEvents:none
- [21-embedpdf-worker-engine-hangs](./21-embedpdf-worker-engine-hangs.md) — EmbedPDF worker 引擎 openDocument 永久挂起(blob worker 里 pthread 辅助 worker 解析不了),暂用直连引擎 + tiling
- [22-embedpdf-scrolltopage-viewport-gap](./22-embedpdf-scrolltopage-viewport-gap.md) — scrollToPage 的 pageCoordinates 多加 viewport gap,页内位置还原要减掉
- [23-embedpdf-current-page-metrics-zero](./23-embedpdf-current-page-metrics-zero.md) — "当前页"的可见区 origin 常是 0,持久化锚点要用最顶上的可见页
- [24-pdfjs-operatorlist-needs-dom](./24-pdfjs-operatorlist-needs-dom.md) — pdf.js getOperatorList/render 要 DOMMatrix,只能在 webview 跑,bun 测试覆盖纯函数
- [25-embedpdf-no-region-raster](./25-embedpdf-no-region-raster.md) — EmbedPDF 适配层没有区域截图,图片裁剪改用自带 pdf.js 渲染
- [26-plugin-http-abort-resource-id-leak](./26-plugin-http-abort-resource-id-leak.md) — Tauri http 插件 abort 后 fire-and-forget 取消,泄漏 "resource id N is invalid" 未捕获拒绝
