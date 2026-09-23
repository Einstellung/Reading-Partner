# 中文句号顶着粗体的收尾星号，粗体就不收了

## 现象

聊天里 AI 的中文回复经常整句连星号一起显示：

```
**结论：**这样不行
**为什么这会毁掉“点积=相似度”。**点积衡量的是
```

`这是**重点**。` 这种是好的，英文 `**bold**text` 也是好的。只有收尾的 `**` 左边挨着中文标点、右边挨着汉字时才坏，而模型写中文时几乎每段都这么写。

## 原因

CommonMark 的 flanking 规则。`**` 要能收尾必须是 right-flanking：左边不是空白，且——左边是标点时——右边必须是空白或标点。全角句号、冒号、右引号都算标点，后面的汉字算字母，两个条件同时不满足，这一串 `**` 就没资格收尾，整段退回纯文本。

规则本身是为了 `a**b` 这种词内星号不要被当成强调，只是它按 Unicode 的字母/标点分类判断，对中文的排版习惯正好判反。

## 解法

`remark-cjk-friendly` 和 `remark-cjk-friendly-gfm-strikethrough`（都是 micromark 扩展，MIT），把 CJK 的标点和汉字之间那条边界排除在 flanking 判定之外。删除线走 gfm 自己的 `~~` 语法，要单独一个插件，且必须排在 `remarkGfm` 后面。

插件表在 `src/ui/components/markdown/remarkPlugins.ts`，单独一个模块是因为 `MarkdownRenderer.tsx` 是 `React.lazy` 的切分点，从它上面导出常量迟早会被主包静态 import 进去，把 KaTeX 和 highlight.js 一起拖回主包。守着的单测是同目录的 `Markdown.cjk.test.tsx`。
