现状见 [docs/64](../reading/64-epub纸页.md)：EPUB 是桌上固定几何的纸页，和 PDF 同一套缩放与布局。手机不排纸页，读同一本书的重排列，见 [docs/70](../reading/70-手机读EPUB.md)。

# EPUB 支持

## 愿景

读书场景。一个主题里 PDF 和 EPUB 混挂,论文和书一起读。这是 00/01 文档的既定设想。

## 状态:已随 v0.16 发出

方案见 [39](../reading/39-epub支持调研.md),渲染侧的实测结论见 [epub渲染spike](../research/epub渲染spike.md)。摄入(阶段 2)、接引擎(阶段 3)、标注(阶段 4)都已发出,桌上和手机都能读能划;手机形态按 [70](../reading/70-手机读EPUB.md) 落地。只剩图的视觉描述(阶段 5)没做。

## 已定的事实

引擎 foliate-js,vendor 在 `vendor/foliate-js/`。页码没废:EPUB 3 自带 `page-list`,没有的按 1800 字符切,分页表写一次不再重算(`pagination-<bookId>.json`)。精确位置是 CFI,只有阅读位置和标注用它。摄入和渲染共用同一份消毒后的树,CFI 因此两边指同一个节点。
