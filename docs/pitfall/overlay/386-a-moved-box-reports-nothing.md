# 386 只是挪了位置的盒子，callback ref 和 ResizeObserver 都不吭声

## 现象

手机课堂屏上 Lumen 压着输入框的发送键。按桌面那套把 composer 的元素交给 `useCornerLift`
量，手机上量出来 `liftPx=0`，Lumen 一动不动。探针打出来：ref 挂上了（`attach=el`），量到的盒子
是 `top=573 bottom=635`，视口高 874 —— 那是空对话时居中的 composer 的位置，不是屏幕底部那个。
对话已经有五条消息了。

## 原因

`CallView` 的空态和非空态是一个三元表达式的两个分支，composer 在两个分支里都是同一个父节点下
同一个下标上的 `<div>`。React 按下标和类型对齐：前一个子节点从 `<h1>` 变成 `<div>` 会重建，
composer 那个 `<div>` 类型没变又没有 key，于是**复用同一个 DOM 节点**，只改 className。

复用意味着两件事同时不发生：

- callback ref 的函数身份没变（`useCallback` 出来的），React 不会再调一次，量尺寸的 effect
  也就不重跑；
- `ResizeObserver` 只在盒子的**尺寸**变化时触发。这个盒子从屏幕中间挪到底边，宽高没变，一声不响。

`window.resize` 也不会响——视口没变。于是测量停在第一条消息到达之前那一帧。

## 解法

给两个分支的 composer 各一个 key（`composer-centred` / `composer-edge`）。分支一换，React 拆了
重建，callback ref 带着新节点再来一次。

推广：拿 callback ref 量另一个元素的位置时，ref 只报"元素换了"，`ResizeObserver` 只报"大小变了"，
**位置变了没有人报**。只要那个元素会在同一个父节点里挪窝，就得让它在挪的时候换身份。
