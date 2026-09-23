# 入口 chunk 会在运行期再插一遍自己的样式表，改 HTML 里的 link 没用

## 现象

量 `coarse:` 变体的做法是把产物 CSS 里的 `@media (pointer: coarse)` 换成 `@media all`，存成 `styles-XXXX.coarse.css`，再复制一份 HTML 把 `<link>` 指过去。页面能打开，样式也在，但量出来全是细指针的值：设置页的输入框还是 14px，不是 `coarse:text-base` 的 16px。

## 原因

Vite 的入口 chunk 自己也会 `import` 那份 CSS，运行期再往 `<head>` 里插一个 `<link>`，指向原始文件名。两份样式表都加载了，后插的那份在后面，同层同特异性，后面赢。

`document.styleSheets` 直接看得见：coarse 那份在前，原始那份在后。

## 解法

不要在 HTML 里换 link，直接整份 dist 复制一遍，在副本里就地改那个 CSS 文件，然后拿另一个端口伺服。文件名不变，运行期插进来的就是改过的那份。

`scratchpad` 里的 `stage.py` 就是这么做的：`dist-probe` → `dist-probe-coarse`，assets 里的 `.css` 原地替换。
