# 长按正文不能弹系统选区，靠的是祖先节点上的一条规则，不是页卡片自己

## 背景

这条坑原来是 iframe 时代的：书的正文渲染在一个独立文档的 iframe 里，`-webkit-touch-callout: none`
写在 iframe 内的书自己的文档上管不到父页——iframe 设 `pointer-events: none` 之后，长按不再落到书上，
落到了阅读区自己身上，那一层没人关过原生选区，iOS 就给了一个空选区配一个 Copy / Translate / Share
菜单。这个前提已经不成立：现在的 EPUB 渲染没有 iframe，每一页是直接挂在阅读区 DOM 里的 shadow host
（`FlowReaderView` 的页卡片，见坑 279、304），和阅读区的滚动容器是同一个文档。

## 现状

`user-select` 和 `-webkit-touch-callout` 都是可继承的 CSS 属性，shadow 边界不挡继承：只要滚动容器
（`.rp-flow`）带着 `data-reader-surface`，`styles.css` 里那条规则

```css
[data-reader-surface] {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
```

就会顺着 DOM 树一路继承进每张页卡片的 shadow root，不需要在页卡片自己身上、或者书的消毒输出里再补一遍。
PDF 那侧的阅读区一开始就带这个属性（同族坑 49），EPUB 的 `.rp-flow` 也在创建时就设了（`flow-view.ts`）。

## 结论没变

阅读区的根节点必须有 `data-reader-surface`，删掉它原生选区和长按菜单就会回来。这条对 PDF 和 EPUB
两侧都成立，且不依赖内容是不是在 iframe 里——只依赖它是不是在这个属性的继承链上。笔要拖的选区不受
影响：那条选区是宿主自己用 `caretRangeFromPoint` 画出来的，不经过这条规则关掉的原生选区通道。
