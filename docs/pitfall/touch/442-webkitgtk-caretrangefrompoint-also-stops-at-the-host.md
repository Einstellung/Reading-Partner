# 442 WebKitGTK 2.52 的 `document.caretRangeFromPoint` 也停在 shadow host

## 现象

桌面（Linux，WebKitGTK 2.52.6）EPUB 纸页上，`document.caretRangeFromPoint` 对纸页正文上的点一律返回 light DOM 里的 `DIV@0`，拿不到 shadow root 里的文本节点。Moby-Dick 和 Alice 两本书、翻页和竖排两种布局，1581 次查询没有一次例外。坑 278 和 docs/64 记的「WebKitGTK 上 document 的能穿进 shadow root」在这个版本上不成立。

## 原因

WebKitGTK 在 2.52 之前某个版本改成了和 WKWebView 一样：`caretRangeFromPoint` 的结果按 shadow 边界重定向到宿主。ShadowRoot 上仍然没有这个方法。

## 解法

不用改代码：`caret.ts` 已经把停在宿主的结果当没答案，落到自己量的那条。这意味着桌面划线走的是 `searchForCaret` 的二分，和 iOS 同一条路，纸页的多栏排版对它的影响（坑 435、436）桌面也有：旧的二分在页中间一行上会落到别处、划到页末会带上下一页的字。在 Linux 上改 `caret.ts` 的二分，用 WebKit2 绑定在 xvfb 里开 vite 页面、`run_javascript` 调 `caretAtPoint` 就能量，桌面就是它的真机。
