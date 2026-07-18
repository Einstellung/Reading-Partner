# EmbedPDF 的 searchInPage 在类型里有，却不在 PdfEngine 上

现象：想给一页文字做定点搜索拿高亮矩形，`@embedpdf/models` 的 `.d.ts` 里明明有 `searchInPage(doc, page, keyword, flags): PdfTask<SearchResult[]>`，直接 `engine.searchInPage(...)` 编译不过——`engine`（`getPdfiumEngine()` 返回的 `PdfEngine`）上没有这个方法。

原因：`searchInPage` / `searchBatch` 声明在 `IPdfiumExecutor` 接口上（PDFium 执行层），不在对外的 `PdfEngine` 接口上。`PdfEngine` 只暴露 `searchAllPages(doc, keyword, options)`（全文档搜索）和 `getPageGeometry` / `getPageTextRects` / `getPageGlyphs`（后三者给的是几何盒子，不带字符，单独拿它们没法按文本定位子串）。

解法：定点搜索走 `searchAllPages`，再按页过滤：

```ts
const res = await engine.searchAllPages(doc, keyword, { flags: [] }).toPromise();
const hit = res.results.find((r) => r.pageIndex === pageIndex && r.rects.length > 0);
```

`flags: []` = 不区分大小写、不整词匹配。`SearchResult.rects` 是页面空间、左上原点的 `Rect[]`（和 `convert.ts` 里标注用的坐标系一致），可直接乘以 `pageBox宽/页面点宽` 的缩放画成覆盖层。PDFium 搜索是精确子串（不折叠连字/空白），跨行的引文可能整段匹配不上；把关键词逐步截短（全句→前 8 词→前 5 词→前 3 词）能兜住一部分。彻底找不到就退化成只显示引文文字的 banner。

矩形与页面的像素对齐是按"同坐标系"推断的，真机需实测确认零漂移。
