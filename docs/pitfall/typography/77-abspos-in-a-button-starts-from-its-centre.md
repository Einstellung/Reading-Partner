# `<button>` 里的绝对定位子元素从按钮中心起算，不是内容框原点

## 现象

`SourcesPage` 的开关（36×20 轨道，16px 圆点）画错：开着的时候圆点整个跑到轨道右边外面看不见，关着的时候圆点贴在轨道右侧。代码写的是

```html
<button class="relative h-5 w-9 rounded-full">
  <span class="absolute top-0.5 h-4 w-4 ... translate-x-4"><!-- on --></span>
  <span class="absolute top-0.5 h-4 w-4 ... translate-x-0.5"><!-- off --></span>
</button>
```

按代码读，off 应该在左边 2px、on 在左边 16px。实测圆点的 `getBoundingClientRect().left` 减轨道左边是 20 和 34，正好都多了 18px = 轨道宽度的一半。

## 原因

`<span>` 只写了 `top`，没写 `left`/`right`，横向用的是静态位置（static position）——它在正常流里本该出现的地方。

Chrome 给 `<button>` 的内容包一层匿名的居中盒（相当于 `align-items: center; justify-content: center`）。绝对定位的子元素不参与流，在那个居中盒里退化成一个点，这个点在内容框的水平中心。于是静态位置是 18px（36 的一半），而不是 0。

写了 `left` 的绝对定位子元素不受影响，因为它根本不用静态位置。项目里其它按钮内的绝对定位元素（`HIT_44` 的 `before:left-1/2`、设置按钮的红点 `absolute right-0.5`、聊天的角标 `absolute -right-1.5`）都显式写了边，所以只有这个开关中招。

preflight 不相干：它把 `padding` 清成 0，但匿名居中盒是 `<button>` 的渲染方式，不是某条 UA 样式。

## 解法

给按钮一个显式的 `display`（`flex` / `inline-flex` / `block`），匿名居中盒就没了，静态位置回到内容框原点。改成 shadcn/Radix 的 `Switch` 顺带修好了这个，因为它的 Root 是 `inline-flex`。

一般规则：绝对定位子元素放在 `<button>` 里，要么给按钮显式 `display`，要么给子元素显式 `left`/`right`。两个都不做就会偏半个按钮宽。
