# 内容变短之后 WKWebView 还报着旧的滚动偏移

## 现象

iPad 上 EPUB 纸页阅读器，纵向栏滚到第 5 页再从 More 菜单切「Paged flip」，整个阅读区全白，之后每次翻页都还是白的，页码照常从 5/267 走到 6/267。控制台没有报错。量出来：`scrollLeft 3336, scrollTop 2144, clientHeight 1114, scrollHeight 3258`，`.rp-strip` 的视口 y 是 -2068 —— 只有一行卡片的页带整条被顶到视口上方。`scrollHeight` 正好等于 `clientHeight + scrollTop`，也就是滚动容器把那 2144 当成了自己的内容高度。

## 原因

切布局时 `applyGeometry()` 把页带高度从「页数 × 页距」改成一个 slot 高，内容一下变矮了两千多像素，而 `placePage` 的 paged 分支只写 `scrollLeft`，没碰 `scrollTop`。WKWebView 不会在内容变短时自己把过期的 `scrollTop` 夹回范围内，也不发 scroll 事件：它继续报旧偏移，并把这段多出来的量算进 `scrollHeight`，直到有人往这条轴上写一次值。

## 解法

换布局、换缩放这类会改内容尺寸的操作之后，把该布局自己拥有的那条轴无条件写一遍，哪怕答案是 0。摆位算术收进 `reader-logic.ts` 的 `pageScroll()`：paged 返回 `scrollTop: 0`，纵向返回 `columnScrollTop(...)` 并让 `scrollLeft` 为 null（那条轴归读者自己平移）。别指望 `scrollTop` 已经在范围内就不用写。
