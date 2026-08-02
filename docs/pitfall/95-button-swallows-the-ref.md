# `<Button>` 把 ref 吃掉，不报错

已修复：`src/ui/components/ui/` 下每个渲染 DOM 节点的组件都改成了 `forwardRef`。下面留着是因为一次 `bunx shadcn@latest add` 就会把它写回来。

## 现象

把一个手写 `<button ref={swatchRef}>` 换成 `<Button ref={swatchRef}>`，样式对、点击对，但 `swatchRef.current` 永远是 `null`。依赖这个节点做的事情静默失效——笔工具色板量不到锚点，`placePanel` 拿不到 `getBoundingClientRect()`，浮层不出现或者停在原点。

生产构建里连一句警告都没有：React 18 那条 "Function components cannot be given refs" 只在开发构建里打。

实测（探针页，React 18.3，生产构建）：同一个组件里两个 ref，`<Button ref>` 拿到 `null`，紧挨着的 `<button ref>` 拿到 `BUTTON`。

## 原因

shadcn 现在生成的组件是照 React 19 写的（那里 `ref` 是普通 prop），本项目还在 React 18，`ref` 在函数组件上不是 prop，React 直接丢掉。

不只是 `button.tsx`。包着 Radix 的那些也一样：Radix 自己转发 ref，但接到 ref 的是这里的包装函数，ref 在到达 Radix 之前就没了。

类型不会拦：`React.ComponentProps<"button">` 里带 `ref`，所以 `tsc` 全绿。

## 解法

`forwardRef`，ref 透传到它实际渲染的那个元素上：

```tsx
const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} data-slot="button" className={...} {...props} />;
});
```

`asChild` 下 ref 交给 `Slot`，它把这个 ref 和被替换子元素自带的 ref 合并到同一个节点上（实测：两个 ref 都拿到那个 `<a>`，`slot.current === child.current`）。

只渲染 context 和状态、不产生 DOM 的那几个不用改：Radix 的 `Dialog` / `AlertDialog` / `DropdownMenu` / `Select` 根、各种 `Portal`、`ToastProvider`、`OverlayLayer`。

## 护栏

`tests/ui/components/forward-ref-contract.test.ts`。三条：`ui/` 下每个文件都要登记在表里；每个大写开头的导出要么是 `forwardRef` 产物（`$$typeof === Symbol.for("react.forward_ref")`），要么在"不渲染 DOM"的名单里；每个 `React.forwardRef<` 都要有一处 `ref={ref}`。另外直接调用 `Button.render(props, ref)`，断言 ref 落在返回的元素上，`asChild` 下落在 `Slot` 上。

测试环境只有 `react-dom/server` 静态渲染，跑不到 ref，所以断言的是"让 ref 能落地的那两件事"，节点对不对由产物里量。

## 怎么判断某一处中招

只能量：`ref.current` 是不是 `null`。别信没有警告。
