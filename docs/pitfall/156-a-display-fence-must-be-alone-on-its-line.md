# `$$` 不单独占一行，整段回复就变成一堵红色的 LaTeX

## 现象

AI 回复里的多行公式连同后面的正文一起渲染成红色原文（红色是 rehype-katex 的 errorColor）：

```
$$S=\begin{bmatrix}
0.9995&0.9544
\end{bmatrix}$$

现在把 x₃ 和 x₄ 对调。
```

单行的 `$$x=1$$` 是好的。翻了本机全部会话：62 条回复写过 `$$`，其中 162 处是单行成对的，多行公式 2 处、全坏，写成规范形式（`$$` 独占一行）的 0 处——而提示词里已经写着块公式用 `$$...$$`。

## 原因

remark-math 的 flow 规则。开头那行 `$$` 后面还有东西，那些东西变成节点的 `meta` 被静默丢掉；收尾必须是只有 `$$` 的一行，`\end{bmatrix}$$` 不算收尾，`$$ 然后。` 也不算。没收上的块一路吃到文本结尾，于是公式和后面的正文一起进了同一个 math 节点，KaTeX 解析不了就整块涂红。

`$$x=1$$` 写在一行反倒对：`meta` 里会出现 `$`，flow 构造失败，退回 inline math。

## 解法

在交给 react-markdown 之前把围栏搬到自己的行上：`src/ui/components/markdown/mathFences.ts` 的 `canonicalizeMathFences`，装在 `MarkdownRenderer.tsx` 里 `linkifyCitations` 前面。配对要照 remark 的规则算（`\$` 转义、行内代码、代码块里的 `$$` 都不是分隔符，开三收二不配对），插进去的每一行都得带上列表和引用的前缀，否则块会从列表项里掉出来。还没等到收尾的 `$$` 转义成 `\$\$`，不然流式过程中那堵红墙会一直立到公式写完。守着的单测是同目录的 `mathFences.test.ts` 和 `Markdown.math.test.tsx`。

和 153 是同一个渲染路径的两面：153 是 CommonMark 的规则对、模型的中文写法少见，靠加插件放宽解析器；156 是 remark-math 的规则对、模型的围栏写法少见，改的却是解析器之前的源码，不是再加一个插件。
