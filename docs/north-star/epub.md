# EPUB 支持

## 愿景

读书场景。一个主题里 PDF 和 EPUB 混挂,论文和书一起读。这是 00/01 文档的既定设想。

## 为什么现在不做

核心场景是论文,以 PDF 为主。EPUB 的位置体系是 CFI 字符串,和 PDF 的页码体系全面分叉:阅读状态、痕迹列表显示、跳转都要分两套处理。现阶段做会拖慢基本盘。

## 将来做时已知的事实

- 引擎原生支持 `type: 'epub'`(docs/04 对接备忘)。
- 跨 realm ArrayBuffer 有已知修法:`vendor/reader/src/index.web.js` 里 `window.ArrayBuffer = window.top.ArrayBuffer` 那段,以及 pitfall 10。
- annotations 的 EPUB 更新分支未实测(docs/04 有注,合并逻辑是顶层 spread,同源但没跑过)。
- EPUB 样式内联在 view.js 里,不在 view.css(docs/04 产物清单有注)。
