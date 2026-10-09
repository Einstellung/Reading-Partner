# 手机外壳里 `fixed` 的整屏层不跟着外壳给键盘让位

## 现象

iPhone 上 Lumen 的打字对话（`lumen/DoorChat.tsx` 手机形态，`fixed inset-0`）点输入框：顶栏和关闭键出了屏幕，输入框顶到状态栏和灵动岛底下，键盘上方空一大截。点发送只收起键盘，消息没发出去。

实测（iPhone 16，393 宽，iOS 26.5 模拟器）：聚焦后 `scrollY` 281（有历史时 403），`visualViewport.offsetTop` 280、`height` 449，`innerHeight` 571，整屏层的 top 在 -281。

## 原因

坑 443 的解法是外壳（`KeyboardShell`）在键盘弹起时把 `top` 设成 `visualViewport.offsetTop`，挪到 WebKit 卷到的地方。它特意用 `top` 不用 transform，外壳因此不是里面 `fixed` 元素的包含块：`fixed` 的层仍按 layout viewport 定位，跟着文档一起被卷上去，外壳挪了它没挪。里面的 `CallView` 照外壳报来的 `covered` 给自己垫了底，于是输入框按挪过的外壳排、层却没挪，两头都不对。

## 解法

手机上整屏的对话层画在外壳里、用 `absolute inset-0`（外壳本身是 `relative`），和书的课堂、简报对话一样随外壳挪。`fixed` 只留给不含输入框、或者不在 `KeyboardShell` 里的层。
