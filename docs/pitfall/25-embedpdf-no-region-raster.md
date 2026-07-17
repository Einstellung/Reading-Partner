# EmbedPDF 适配层没有"把页面区域截成图"的能力，图片裁剪走自带的 pdf.js

现象：M9 要把论文的图按 bbox 从页面裁成图片（聊天内嵌卡片 + 喂视觉模型）。原计划复用"区域标注截图"那条路，但 EmbedPDF 适配层（`src/reader-embedpdf/`）根本没有区域光栅化：`ViewInstance` 只有导航/缩放/标注增删，`image` 工具类型在 `EmbedReaderPane` 里直接退化成 `pointer`（没有 EmbedPDF 对应实现）。底层 `PdfEngine.renderPageRect` 倒是有，但它服务于当前打开的文档，为裁图再在共享引擎上开第二份文档要处理跨源隔离 + `worker:false` + 生命周期（坑 18/21），不划算。

解法：图片裁剪不碰 EmbedPDF 引擎，直接用全文提取已经加载的 pdf.js（`src/figures/render.ts`）。同一个库既算 bbox 又渲染，坐标系天然一致，不用在 PDFium 和 pdf.js 两套坐标间来回翻。

做法：整页按目标缩放渲进一张只有裁剪区大小的 canvas，靠 `render({ transform: [1,0,0,1, -x*scale, -y*scale] })` 把裁剪区左上角平移到 canvas 原点，pdf.js 自动裁掉画布外的部分。bbox 存的是左上原点页面空间（跟 `convert.ts` 一致），渲染前加一点 margin。裁不出来（无 canvas / 渲染失败 / 非当前书）就退化成文字 chip。
