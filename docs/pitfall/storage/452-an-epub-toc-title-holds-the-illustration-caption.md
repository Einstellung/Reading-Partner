# EPUB 目录条目的标题里带着插图说明，章号是罗马数字

## 现象

手机 EPUB 课堂上读 Project Gutenberg 的《傲慢与偏见》（1342，插图版）：工具行写 "Reading chapter 6"，同一回合 read_chapter 写下的焦点行是 "CHAPTER V. · p.24-25"；焦点行还出现过 "I hope Mr. Bingley will like it. CHAPTER II. · p.16-17"。

## 原因

两件事都是书自己的 nav 目录（`toc.xhtml` 和 `toc.ncx` 一样）给的。

- Ebookmaker 用整个 `<h2>` 的文字生成目录条目，插图章节的 `<h2>` 里先是 `<img>` 和 `<span class="caption">`，再是 "CHAPTER II."，于是条目标题就是「说明 + 章名」。63 条里 34 条这样，还有两条写成 "CHAPTERXXVII."，中间没空格。
- 章号是罗马数字，`chapterNumber` 只认阿拉伯数字，整张表一个印刷章号都没有，于是退回按顺序编号；目录第一条是 "PRIDE. and PREJUDICE"（Saintsbury 的序，有正文，不被过滤），每章的序号都比印刷章号大一。模型按 `[ch.6] CHAPTER V.` 调 read_chapter(6)，工具行照参数写 6。

## 解法

`src/reading/chapters/table.ts`：`chapterNumber` 认 "chapter" 后面的罗马数字（空格可省）；`chapterTitle` 在章节标题前有一句以句末标点结尾的话时把它切掉，`chapterRanges` 建表时就用它。表的标题、印刷章号、提示词里的 `[ch.N]`、工具行和焦点行于是都指同一章。书的阅读器目录照 nav 原样显示，不动。
