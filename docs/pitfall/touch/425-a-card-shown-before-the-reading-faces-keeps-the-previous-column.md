# 字体没到就挂的页卡片停在上一列

## 现象

iPad 翻页模式打开 EPUB，划一条高亮，存盘的 `pageIndex` 对，页面上却看不见；相邻两个页码显示同一列正文；卡片被池子回收再挂一次后又自己好了。冷启动后除了这本书第一次打开（那次要切分页表），之后每次打开都中。

## 原因

卡片挂上时按页首 CFI 量一次它在第几列（`page-card.ts` 的 `show`），只量这一次。`reader-view.ts` 的 `createEpubReader` 拿到分页表就挂卡片，不等 Noto Serif。回退字体更密，页首落在前一列，于是卡片显示第 ordinal-1 列；字体到了正文重排，卡片的 `translateX` 没人重算。分页表是存盘的时候量尺不跑，而量尺是唯一等字体的地方（`page-ruler.ts`），手机的 flow view 自己等了，翻页的 desk 没等。

## 解法

`createEpubReader` 在 `ensurePagination` 之后、建第一张卡片之前 `await readingFontsReady()`，和 `flow-view.ts` 一样。`tests/reading/epub/reader-fonts-contract.test.ts` 按源码顺序盯着。
