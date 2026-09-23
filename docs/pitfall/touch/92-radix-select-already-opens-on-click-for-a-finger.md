# Radix 的 Select 自己在触摸上开在 click，不要照抄 DropdownMenu 的绕法

## 现象

按坑 83 的结论，本来准备给 `SelectTrigger` 也加一遍「pointerdown 上 `preventDefault()`、自己在 click 上开」。加之前先量了一下，发现根本不需要：一次点按抬手时列表还不在 DOM 里。

## 原因

两个原语的 trigger 写法不同。`DropdownMenuTrigger` 在 `onPointerDown` 里无条件 `onOpenToggle()`；`SelectTrigger` 分指针类型：

```js
onClick: (event) => {
  event.currentTarget.focus();
  if (pointerTypeRef.current !== "mouse") handleOpen(event);
},
onPointerDown: (event) => {
  pointerTypeRef.current = event.pointerType;
  if (event.button === 0 && event.ctrlKey === false && event.pointerType === "mouse") {
    handleOpen(event);
    event.preventDefault();
  }
},
```

鼠标开在 pointerdown（按住拖到某项再松手要靠它），手指和笔开在 click。`SelectItem` 那半也对称：`onPointerUp` 只在 mouse 下选中，非 mouse 走 click。

## 解法

原样用。实测（Chromium 触摸上下文，`hasTouch` + `isMobile`）：

| | 结果 |
|---|---|
| 一按 trigger，pointerup 时列表已存在 | 否 |
| 一按 trigger 顺手选中了某一行 | 否（`__picked` 仍为 0） |
| 再按一行 | 选中一次，列表关闭 |
| 按外面 | 关闭，没有多余的选中 |

再套一层坑 83 的绕法反而会双开：那条绕法把 Radix 的 pointerdown 压掉之后自己在 click 上 toggle，而 Select 的 click 本来就会开。

无头 WebKit 在这台机器上仍然起不来，iOS 的幽灵点击本身还是没有实机验证；量的是它的前提。
