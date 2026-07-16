# EmbedPDF initialDocuments 卡在 loading

现象：`createPluginRegistration(DocumentManagerPluginPackage, { initialDocuments: [{ buffer, documentId, name }] })` 注册的初始文档，documentState 停在 `loading` / progress 0，不加载。但同一个 doc-manager 上，等 registry 起来后手动调 `openDocumentBuffer(...)` 就正常出 pageCount。

原因：initialDocuments 在 registry 初始化期间加载，和引擎起来的时序打架，加载卡死（这是在跨源隔离头补好、引擎用直连之后仍复现的，和 18 的两个原因无关）。

解法：不用 initialDocuments。注册时给空 config，在 `EmbedPDF` 的 `onInitialized(registry)` 里显式 `await docManager.openDocumentBuffer({ buffer: buf.slice(0), documentId, name, autoActivate: true }).toPromise()`，再接后续 wiring。`buf.slice(0)` 传一份拷贝，避免 wasm 把宿主原 buffer detach 掉。
