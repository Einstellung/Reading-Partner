# EPUB 支持

## 愿景

读书场景。一个主题里 PDF 和 EPUB 混挂,论文和书一起读。这是 00/01 文档的既定设想。

## 为什么现在不做

核心场景是论文,以 PDF 为主,EPUB 不影响当前里程碑。方案本身已经想清楚——引擎、位置体系、迁移代价、分阶段工期,见 [39](../39-epub支持调研.md)。

## 将来做时已知的事实

见 [39](../39-epub支持调研.md):引擎选 foliate-js;页码不用废掉(EPUB 3 自带 `page-list`,没有的按固定字符数切),只新增一层精确位置(`Locator`),`Fulltext.pages[]` 等派生数据原样保留;分五个阶段,量级从 1-2 天到 1-2 周不等;第七节列了只有真机才能验的未知数。

> 下面四条记于 zotero/reader 时代,已被 39 取代("引擎原生支持 epub"这个前提随 EmbedPDF 换引擎没了,vendor/reader 和 docs/04 的接法也不适用),只当历史读:引擎原生支持 `type: 'epub'`(docs/04);跨 realm ArrayBuffer 的修法(`vendor/reader/src/index.web.js`,pitfall 10);annotations 的 EPUB 更新分支未实测(docs/04);EPUB 样式内联在 view.js 不在 view.css(docs/04)。
