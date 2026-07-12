# 宿主页必须和 pdf/ 目录同级

现象：嵌入 view.js 后 PDF 不渲染，pdf.worker、cmaps、字体 404。

原因：pdf.js 用 iframe 加载，`src` 是相对路径 `pdf/web/viewer.html`，相对当前文档 URL 解析。worker、cmaps、standard_fonts、wasm 全走这个相对根。

解法：加载 view.js 的宿主页（reader-host.html）必须和 `pdf/` 目录放在同一级，整个 view-web 产物目录作为一个整体部署。
