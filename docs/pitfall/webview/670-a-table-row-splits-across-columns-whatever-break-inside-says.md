# 表格行在 CSS 列里照样被切开，`break-inside: avoid` 管不住

## 现象

EPUB 里的长表格（如 arXiv 论文的算子表）翻页时，最后一行被切成两半：行里别的格留在上一页底部，行首的编号格掉到下一页顶部。iPad 上读者看到的是"内容被截断"。

## 原因

页卡片用 CSS 多列分页。WebKit 在列碎片化时不遵守表格行的 `break-inside: avoid`：在 `tr`、`td`、`th` 上写 `break-inside`、`page-break-inside`、`-webkit-column-break-inside` 三种写法，WebKitGTK 上同一行仍然在同一位置被切开（2026-10-24 用 PaSaMaster/PaperPilot 合订本第 26/27 页复现，加样式前后截图一样）。书自己的样式表里加同样的规则也一样。

## 解法

没有一行样式的解法。要避免，只能在分页时自己处理：量到最后一行跨列就整行推到下一列（插入一段空白或把该行起的表格尾部放进下一页）。未做；表格长到跨页的书目前接受这个缺陷。
