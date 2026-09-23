# `collisionPadding` 救不了本身就在安全区外的锚点

## 现象

给 Radix 的 popper 传了 `collisionPadding: { right: 44, ... }`，触发器贴在视口右缘，菜单打开后离右缘只有 32px，不是要求的 44px。`--radix-popper-available-width` 又确实按 44 算了。

## 原因

`shift` 中间件带 `limitShift()`：横向推动最多推到浮层不再与锚点相接为止。触发器宽 32px 且右缘与视口右缘齐平，菜单右缘最多退到触发器左缘，也就是离视口 32px，再退就脱锚了。Radix 宁可让浮层留在锚点边上，也不让它飘走——对一个下拉菜单来说这是对的。

`collisionPadding` 管的是"从哪条线开始算越界"，管不了"越界之后能挪多少"。

## 解法

保证锚点自己在安全区里，这本来就是外壳该做的：`p-safe` 的容器把顶栏整体推进来，触发器跟着进来，菜单落在触发器右缘，自然就在安全区内。实测（视口 1000px，右 inset 44px）：容器不带 `p-safe` 时菜单离右缘 32px，带上之后 44px。

`collisionPadding` 仍然要传，它管的是另外三件事：翻边的时机、够不够高、`--radix-popper-available-*` 的取值。三件都实测跟着 inset 走。

推论：锚定型浮层的安全区，最多只能和它的锚点一样安全。
