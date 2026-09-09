# 长按选区没消失，它挪到父页去了

## 现象

书的 iframe 设了 `pointer-events: none`（坑 252），书里的 `-webkit-touch-callout:
none` 也在。长按正文，iOS 照样弹 Copy / Translate / Share。frame 文档里的选区是
空的，父页的 `document.getSelection()` 是一个换行符，锚在阅读区那个空的宿主
div 上。

## 原因

长按不再落到书上，落到了阅读区自己身上。书里的那条 callout 规则管的是书的
文档，父页这一层没人关过原生选区，iOS 于是给了一个空选区配一个编辑菜单。

## 解法

阅读区加 `data-reader-surface`——`styles.css` 里那条规则（`user-select: none` +
`-webkit-touch-callout: none`）PDF 那侧从一开始就带着。书自己的文档是另一个
文档，不继承这条规则，笔要拖的选区照样能选。
