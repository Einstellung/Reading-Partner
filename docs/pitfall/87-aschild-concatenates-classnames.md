# `asChild` 的 className 是拼接的，不走 `cn()`

## 现象

设置页的标题接进 Radix 的 `DialogTitle`，用 `asChild` 保住原来的 `<h1>`：

```tsx
<DialogTitle asChild>
  <h1 className="m-0 text-[22px] font-bold">Settings</h1>
</DialogTitle>
```

量出来 `font-weight: 700 → 600`、`line-height: 33px → 22px`，标题行矮 5px，它下面 90 个节点整体上移 5px。写在 `<h1>` 上的 `font-bold` 输给了 `DialogTitle` 默认的 `font-semibold`。

## 原因

`DialogTitle` 自己那份默认类（`text-lg leading-none font-semibold`）已经过了 `cn()`，但 Slot 把它和子元素的 className 合并时只是拼字符串：

```js
className: [slotProps.className, childProps.className].filter(Boolean).join(" ")
```

两串都留在 `class` 属性里，谁赢由 Tailwind 把这两个 utility 排在产物里的先后决定，和写的顺序无关。这一处 `font-semibold` 和 `leading-none` 都排在后面。

## 解法

类写在包装组件上，不写在子元素上。那条路径经过 `cn()`，冲突的默认类会被真正去掉：

```tsx
<DialogTitle asChild className="m-0 text-[22px] leading-normal font-bold">
  <h1>Settings</h1>
</DialogTitle>
```

同族：任何 `asChild` / `Slot` 的包装组件都是这样，Radix 的每一个原语都有 `asChild`。子元素上只留结构和内容，样式一律交给包装组件。
