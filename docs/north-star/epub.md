# EPUB 支持

## 愿景

读书场景。一个主题里 PDF 和 EPUB 混挂,论文和书一起读。这是 00/01 文档的既定设想。

## 状态:进行中

方案见 [39](../39-epub支持调研.md),渲染侧的实测结论见 [62](../62-epub渲染spike.md)。摄入(阶段 2)和接引擎(阶段 3)已落地,EPUB 能读。还剩标注(阶段 4)和图的视觉描述(阶段 5)。

## 已定的事实

引擎 foliate-js,vendor 在 `vendor/foliate-js/`。页码没废:EPUB 3 自带 `page-list`,没有的按 1800 字符切,分页表写一次不再重算(`pagination-<bookId>.json`)。精确位置是 CFI,只有阅读位置和标注用它。摄入和渲染共用同一份消毒后的树,CFI 因此两边指同一个节点。

> 下面四条记于 zotero/reader 时代,已被 39 取代("引擎原生支持 epub"这个前提随 EmbedPDF 换引擎没了,vendor/reader 和 docs/04 的接法也不适用),只当历史读:引擎原生支持 `type: 'epub'`(docs/04);跨 realm ArrayBuffer 的修法(`vendor/reader/src/index.web.js`,pitfall 10);annotations 的 EPUB 更新分支未实测(docs/04);EPUB 样式内联在 view.js 不在 view.css(docs/04)。
