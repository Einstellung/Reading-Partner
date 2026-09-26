# iPad 第一次弹键盘也把整个文档往上卷

## 现象

iPad 上开书、进整窗对话、点输入框：只要这次启动后还没切过 app，顶栏整个出了屏幕（11 寸竖屏顶栏 top 实测 -308）。切走再回来之后再点，顶栏好好的，输入框照样在键盘上方。

## 原因

iPad 在切 app 之前走的是坑 443 那种做法：`innerHeight` 和 visual viewport 一起变矮，页面仍按全高排版，WKWebView 把文档往上卷键盘那么高（11 寸卷 340；13 寸 `innerHeight` 963、`offsetTop` 403、`scrollY` 403，见坑 392 的第一行）。切过一次才换成坑 392 的「只缩 visual viewport」。平板外壳原来只让 `CallView` 自己量 `innerHeight - vv.height - vv.offsetTop`，第一种状态下它恒为 0，外壳也不动，顶栏就跟着文档卷走了。

## 解法

平板/桌面外壳（`App.tsx`）和手机一样套 `common/KeyboardShell.tsx`：卷了就把 `top` 设成 `vv.offsetTop`、尺寸不变，外面 `overflow: clip`；没卷（坑 392 那种）`top` 是 0，被盖住的高度照样经 context 交给贴底的视图。桌面没有键盘，visual viewport 和窗口一样高，什么都不动。

外壳挪回来之后 WebKit 那次卷动就不再替任何输入框让位了，贴在底边的输入框都得自己垫：`CallView`、复述和排练教练的对话（`RetellView`、`CoachView`）、侧栏 Prep 面板，统一用 `useKeyboardRoom()`。
