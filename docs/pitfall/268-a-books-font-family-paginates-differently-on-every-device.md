# 书自己的 font-family 让同一本书在每台设备上排出不同的页数

## 现象

字体已经随 app 打包、基线样式写死 Noto Serif，可页卡片里 `getComputedStyle(html).fontFamily` 仍是 `Georgia, serif`，中文落到系统的黑体。同一本《具身智能》用这套回退排 73 页，改写字体后排 74 页。

## 原因

书的 CSS 保留了（docs/64），它的 `body { font-family: Georgia, serif }` 压过基线。Georgia 没装就回退到通用 `serif`，通用族名解析成设备的默认字体——Linux 是 DejaVu，Mac 是 Times，iPad 又是一套。分页表按字形宽度切页，字体一变页数就变，而表是跨设备同步、写一次不重算的。

## 解法

`css-sanitize.ts` 改写每条 `font-family`：书自带 `@font-face` 的名字保留（内嵌字体随书走），打包的两个名字保留，通用族名和其它具名字体全部换成 `"Noto Serif", "Noto Serif CJK SC", serif`，`monospace` 留通用；`font` 简写带具名字体的整条删。`@font-face` 块里的 `font-family` 是声明名字，不改写。
