# React 18 渲染出对的 SVG 属性，同时对每一个都报警告

## 现象

聊天里的图表卡（`src/ui/components/diagram/DiagramCard.tsx`）把布局算出来的元素树交给 React 渲染，属性名按 SVG 自己的写法带连字符（`stroke-width`、`text-anchor`、`font-size`、`font-family`）。产物是对的——markup 里就是 `stroke-width="1.3"`，图也画得出来——但控制台每渲染一次就刷一屏：

```
Warning: Invalid DOM property `stroke-width`. Did you mean `strokeWidth`?
Warning: Invalid DOM property `text-anchor`. Did you mean `textAnchor`?
```

一张图几十个元素，一次渲染几十条。测试里 `renderToStaticMarkup` 也一样刷。

## 原因

React 18 的 DOM 属性表只认驼峰名，遇到连字符名走「未知属性」分支：值照样写进 DOM（所以结果对），但先报一次警告。React 19 起接受连字符写法，本项目是 18。

`aria-*` 和 `data-*` 是 React API 里本来就保留连字符的两类，把它们一起驼峰化会真的写坏属性，不是消个警告的问题。

## 解法

元素树保持 SVG 的原名——序列化那条路（`serializeSvg`，出独立 SVG 文件）需要真名——在交给 React 的那一层转一次：

```ts
key.startsWith("aria-") || key.startsWith("data-")
  ? key
  : key.replace(/-([a-z])/g, (_all, c: string) => c.toUpperCase())
```

在 `src/ui/components/diagram/SvgFigure.tsx`，那个组件本来就只做「元素树 → React 元素」这一件事。

回归由 `tests/ui/components/diagram-card.test.tsx` 盯着：断言产物里仍是 `stroke-width=` 而不是 `strokeWidth`——只断言「没有警告」抓不住把属性整个丢掉的映射错误。
