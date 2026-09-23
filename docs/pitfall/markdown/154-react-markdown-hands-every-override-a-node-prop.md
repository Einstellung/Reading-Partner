# 给 react-markdown 装的组件都会多收一个 `node`，它会自己跑到 DOM 上

## 现象

AI 回复里的链接渲染出来带一个谁也没写过的属性：

```html
<a href="https://example.com" node="[object Object]">链接</a>
```

引用 chip 那一支也一样。类型全绿，控制台不报警告，只有把 HTML 打出来才看得见。

## 原因

`MarkdownRenderer.tsx` 给 `components.a` 装的是自己的 `Anchor`，签名按 `AnchorHTMLAttributes<HTMLAnchorElement>` 写，剩下的属性 `...rest` 原样铺到 `<a>` 上。react-markdown v10 开着 `passNode`，凡是被换成组件的元素都额外收到一个 `node`（那棵 hast 节点）。`AnchorHTMLAttributes` 里没有这个字段，于是它既不报类型错也没被解构出来，跟着 `rest` 上了 DOM——React 18 对未知的小写属性照写不误，所以也没有警告。

`node` 是 react-markdown 唯一凭空加的属性，其余都来自 hast 节点自己的 `properties`（即真的 HTML 属性），铺出去是对的。

## 解法

从包里导出的 `ExtraProps`（`{ node?: Element }`）交叉进签名，把 `node` 解构出来丢掉：

```tsx
function Anchor({ href, children, node, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps)
```

`noUnusedParameters` 不管带 rest 兄弟的解构，不用改名。以后再给 react-markdown 装别的组件（`code`、`img`、`table`），只要它铺 `...rest` 就要同样处理。守着的单测是 `src/ui/components/markdown/Markdown.props.test.tsx`。
