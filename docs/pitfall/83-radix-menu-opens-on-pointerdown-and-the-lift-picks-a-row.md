# Radix 菜单开在 pointerdown，同一次点按抬手就能选中一行

## 现象

`MoreMenu` 换成 Radix DropdownMenu，用它自带的 trigger：一次点按（触摸尤其）可能既打开菜单又选中落在手指下方的那一行。

## 原因

两处相加。

`DropdownMenuTrigger` 在 `onPointerDown` 里 `onOpenToggle()`，菜单在按下的那一刻就挂到 DOM 上。

`MenuItem` 自己有一条：

```js
onPointerDown: (event) => { isPointerDownRef.current = true; },
onPointerUp: composeEventHandlers(props.onPointerUp, (event) => {
  if (!isPointerDownRef.current) event.currentTarget?.click();
}),
```

没见过 pointerdown 的项，在 pointerup 上自己 click 一次——这是给「按住拖到某一项再松手」准备的，但对刚刚挂上来的项，那次 pointerup 属于打开菜单的那一按。触摸上还多一路：touchend 合成的 click 按落点命中，命中的是新挂上来的那棵树。

原来手写的 `MoreMenu` 开在 `click`，不存在这个窗口。换过去等于新引入。

## 解法

trigger 上把 Radix 那条按下即开压掉，自己在 click 上开：

```tsx
onPointerDown={(e) => { wasOpen.current = open; e.preventDefault(); }}
onClick={() => setOpen(!wasOpen.current)}
```

`composeEventHandlers` 默认 `checkForDefaultPrevented: true`，所以 `preventDefault()` 就能让 Radix 那半不跑；取消 pointerdown 不影响 click 照常派发。

记 `wasOpen` 是因为关闭走的是另一条路：DismissableLayer 在 document 的 pointerdown 上关，那条监听排在 React 根容器之后，所以 click 到达时 `open` 已经是 false，直接取反会立刻再开。React 的 `onPointerDown` 排在 document 那条之前，此刻读到的才是这一按开始时的状态。

键盘不受影响：Radix 的 `onKeyDown` 处理 Enter / Space / ArrowDown 并且 `preventDefault()`，浏览器合成的 click 不会来，不会双开。

实测对照（Chromium 触摸上下文，两份产物跑同一段脚本，量的是 pointerup 那一刻 DOM 里有没有 `[role="menu"]`）：

| trigger | pointerup 时菜单已存在 |
|---|---|
| Radix 原样 | 是 |
| 改开在 click | 否 |

无头 WebKit 在这台机器上起不来，iOS 上的幽灵点击没有实机验证；这个改法把「菜单在抬手时已经存在」这个前提消掉，落点在哪都无所谓了。
