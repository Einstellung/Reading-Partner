# `<Button>` 把 ref 吃掉，不报错

## 现象

把一个手写 `<button ref={swatchRef}>` 换成 `<Button ref={swatchRef}>`，样式对、点击对，但 `swatchRef.current` 永远是 `null`。依赖这个节点做的事情静默失效——笔工具色板量不到锚点，`placePanel` 拿不到 `getBoundingClientRect()`，浮层不出现或者停在原点。

生产构建里连一句警告都没有：React 18 那条 "Function components cannot be given refs" 只在开发构建里打。

实测（探针页，React 18.3，生产构建）：同一个组件里两个 ref，`<Button ref>` 拿到 `null`，紧挨着的 `<button ref>` 拿到 `BUTTON`。

## 原因

`src/ui/components/ui/button.tsx` 是一个普通函数组件，不是 `forwardRef`。shadcn 现在生成的这一版是照 React 19 写的（那里 `ref` 是普通 prop），本项目还在 React 18，`ref` 在函数组件上不是 prop，React 直接丢掉。

类型不会拦：`React.ComponentProps<"button">` 里带 `ref`，所以 `tsc` 全绿。

## 解法

需要 ref 的那个按钮保持原生 `<button>`，用 `buttonVariants` 穿同一件外衣：

```tsx
import { cn } from '../lib/utils';
import { buttonVariants } from '../ui/button';

<button ref={swatchRef} className={cn(buttonVariants({ variant: 'ghost', size: null }), '…')} />
```

样式和 `<Button>` 逐字节相同，节点还在。`size={null}` 是 cva 的显式退出（`variantProp === null` 时连 `defaultVariants` 都不套），给自带几何的控件用。

要判断一处到底有没有中招，只能量：`ref.current` 是不是 `null`。别信没有警告。
