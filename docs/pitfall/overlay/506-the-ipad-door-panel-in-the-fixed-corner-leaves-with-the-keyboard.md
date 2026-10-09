# iPad 上 Lumen 角落里的打字面板被键盘卷出屏幕

## 现象

iPad Pro 11 寸（iPadOS 26.5 模拟器）横屏，Lumen 的打字面板（`lumen/DoorChat.tsx` 面板形态）点输入框：输入框到了 y=-207，关闭键 y=-314，屏幕上只剩面板底下一截空白，Lumen 站在键盘上方。竖屏看着没事。

实测：聚焦后 `scrollY` 372，`innerHeight` 463，`visualViewport.offsetTop` 371.5、`height` 406。

## 原因

和坑 505 同一件事，换在平板外壳：面板画在角落那根 `pointer-events-none fixed inset-x-0 bottom-0` 的列里，`KeyboardShell` 用 `top` 挪回可见区，`fixed` 的列不跟它走，跟着文档被卷上去。另外两处叠在上面：面板高度按 `100dvh` 算，键盘弹起时 `dvh` 不变，横屏可见的 406 装不下 576 的面板；面板里的 `CallView` 又照外壳报的 `covered` 给自己垫了一遍底。竖屏可见高度够，错位藏住了。

## 解法

面板不进角落的 `fixed` 列，在外壳里单开一层 `absolute inset-0`（外壳是 `relative`），随外壳挪。没键盘时这层的底边留白等于角落的边距、拖动抬高和 Lumen 身体加间距，面板仍站在 Lumen 上；外壳报键盘盖住 `covered` 时，底边留白改成 `covered + 8`，面板站在键盘上，高度用 `max-h-full` 收进可见区，Lumen 在面板开着、键盘在的时候隐身。面板里给 `CallView` 的外壳 context 把 `covered` 置 0，不重复垫底（`lumen/door-panel.ts`）。两种键盘做法都验过：文档上卷那种（横屏 `scrollY` 306）面板 48..398，可见 406；只缩 visual viewport 那种（转回竖屏）面板 286..862，可见 870。
