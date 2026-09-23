# 278 WKWebView 的 `document.caretRangeFromPoint` 不穿 shadow root

## 现象

页卡片上同一个点，两个引擎给不同的答案：

| | `ShadowRoot.caretRangeFromPoint` | `document.caretRangeFromPoint` |
|---|---|---|
| Linux WebKitGTK | 没有这个方法 | 穿进 shadow root，给文本节点 |
| iOS 26.5 WKWebView | 没有这个方法 | 停在宿主，给 `DIV@0` |

## 原因

`caret.ts` 三条路：shadow 上的方法、document 上的方法（要判答案在不在卡片树里）、自己按 caret box 二分。iOS 上第二条路的答案永远落在卡片树外，于是走的一直是第三条。Linux 上走的是第二条——两个平台画高亮用的根本不是同一段代码。

## 解法

不用改：第三条路在 iPad 上量过，同一行上 x=200/400/600 给出的字符偏移 647/655/664，单调且落在字上，拖出来的高亮就在字上。要记住的是**在 Linux 上验过 caret 不等于在 iOS 上验过**，两条路各验各的。
