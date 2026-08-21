# EmbedPDF 替换调研

> historical：调研结论已执行，引擎就是 EmbedPDF。实测见 [08](./08-EmbedPDF-spike结果.md)，落地代码在 `src/reading/engine/`。文中的结论读作"当初为什么这么选"，不是现状说明。

2026-07-16 调研定稿。背景:zotero/reader 的 AGPL 与 App Store 冲突(见 `11-iOS-TestFlight发布.md`),issue zotero/reader#231 已发出但成败未知;EmbedPDF 是 MIT,还顺带解除对 CDS 授权的长期依赖、不挡商业化。决定不等 CDS 回复,直接探索替换。只考虑 PDF,不管 EPUB/snapshot。

## 结论

有条件可行,倾向于做。许可证是硬收益:EmbedPDF core 与全部标准插件 MIT,PDFium 走 Apache-2.0(repo LICENSE + LICENSE.pdfium: https://github.com/embedpdf/embed-pdf-viewer)。插件矩阵覆盖我们对引擎的全部真实依赖,headless/vanilla 接入成熟,支持从内存字节加载、host 独立持久化、批注挂任意自定义字段。

代价在适配层形态变了。现在是"在 iframe 里调一个 window.createView,拿回封装好的 view 实例";换 EmbedPDF 后要自己装配 PdfiumEngine + PDFCore + 约十二个 plugin,并把 zotero 那套聚合好的回调(onChangeViewStats、onSetAnnotationPopup 的视口 rect 等)从各插件 state 里自己拼出来。不是难,是工作量前移。

## WASM 与重计算的边界(2026-07-16 讨论补充)

EmbedPDF 的 WASM 是 PDFium(C++)编译产物,渲染是黑盒调用,我们不写渲染代码。将来的重计算(如向量检索)放 Tauri Rust 侧走 command,不放 webview 内 WASM:WKWebView 有页面进程内存上限,PDFium 堆已占一份。用 Rust 写保留"将来编译成 WASM 上纯网页版"的退路。
