# 一条 overflow-x-auto 的滚动带把带里所有浮层都吞掉

## 现象

顶栏工具条的颜色按钮在 iPad 上点了没反应：颜色不换，也看不到调色板。按钮本身是好的，`aria-expanded` 会翻成 true。

## 原因

顶栏中段为了让手机上工具条可以横向滑动，带了 `overflow-x-auto`。`overflow-x` 一旦不是 `visible`，`overflow-y` 的 `visible` 就被算成 `auto`，这个元素成了两个方向都裁剪的滚动容器。调色板是 `absolute top-full`，挂在按钮下方，正好落在这条带子的内容盒之外，于是被裁掉——DOM 里在，屏幕上没有。z-index 提多高都没用，裁剪不是层叠问题。

## 解法

会跑到容器外面的浮层不要用 `absolute` 贴锚点，改成 `fixed` 加开面板时量一次锚点的 `getBoundingClientRect()`：

```tsx
const r = swatchRef.current.getBoundingClientRect();
setPos({ left: r.left + r.width / 2, top: r.bottom + GAP });  // 面板自己带 -translate-x-1/2
```

浮层仍留在锚点的 DOM 子树里，点外面关闭那条 `contains()` 判断照旧成立。

顺带：这个调色板的列宽写死 `1.75rem`，而色块按钮在触摸端是 `coarse:w-11`（44px），四个按钮在 28px 的轨道里互相压住。轨道也要跟着分档（`coarse:grid-cols-[repeat(4,2.75rem)]`），不然浮层露出来了也点不准。
