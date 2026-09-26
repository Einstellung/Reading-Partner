# 跳到小数位 scrollTop 的页读回来是上一页

## 现象

iPad 竖排（fit-width）打开 Peter Rabbit，点 p.6 的引文或图卡，屏幕上是第 6 页、引文底画在第 6 页上，顶栏写 `5 / 38`；存下的阅读位置是 `pageIndex: 4, pageY: 1056`（第 5 页的最底下）。手机 flow view 和卡片都说 p.6。不是每一页都中，看这一页的顶边落在哪个小数上。

## 原因

竖排里第 i 页的顶是 `i * pitch`，pitch 是 `1056 * scale + 8`。iPad 上 scale 是 834/816，pitch 带小数，第 5 页的顶是 5436.47。WKWebView 写进去的小数 scrollTop 读回来是整数（这一页读回来比 5436.47 小），而 `columnPosition` 从槽的起点 `i * pitch` 开始 `floor`，差零点几像素就算进上一页，`pageY` 夹到页高。页卡片本身比槽的起点低半个间距（4px），所以屏幕上看到的是第 6 页，只有顶栏和存盘说第 5 页。Chromium 保留小数 scrollTop，无头浏览器里复现不出来。

## 解法

`page-geometry.ts` 的 `columnPosition` 按纸而不是按槽算：顶边落在两张纸之间的间距里算下面那张，即 `floor((scrollTop + PAGE_GAP / 2) / pitch)`。凡是 `columnScrollTop` 放上去的页，读回来差不到半个间距都还是这一页。`tests/reading/epub/reader-logic.test.ts` 用 iPad 的 scale 把 38 页各按 floor/round/ceil 取整读一遍。
