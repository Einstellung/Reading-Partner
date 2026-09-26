# 键盘把整个文档往上卷，而不是把页面变矮

## 现象

iPhone 上三个对话面（手机 EPUB 课堂、手机 PDF 课堂、简报对话）点输入框：软键盘时顶栏整个出了屏幕，输入框和键盘之间空着一截（约 77px）；硬件键盘只有那条附件栏时，顶栏也被推到状态栏的时钟底下。`CallView` 按 `useKeyboardInset` 加的 padding-bottom 从来没生效过。

实测（iPhone 17 Pro Max，iOS 26 模拟器，956 高）：

| 时刻 | `innerHeight` | `scrollY` | `visualViewport.height` | `visualViewport.offsetTop` | `<html>` scrollTop |
|---|---|---|---|---|---|
| 没聚焦 | 956 | 0 | 956 | 0 | 0 |
| 硬件键盘（附件栏） | 888 | 68 | 888 | 68 | 68 |
| 软键盘 | 543 | 413 | 543 | 413 | 413 |

## 原因

这是坑 392 里「缩 webview」那种做法在 iPhone 上的全貌：`innerHeight` 和 visual viewport 一起变矮，但页面仍按 956 排版，WKWebView 把整个文档往上卷键盘那么高，让输入框露出来。于是顶栏跟着文档卷走。`innerHeight - vv.height - vv.offsetTop` 在这种状态下恒为 0，padding 是 0；空出来的那截是外壳 `p-safe` 的底部安全区（34px，键盘挡住了 home indicator 它却还在）加上输入框下面的留白。

两种状态下，可见区域在文档里都是从 `offsetTop` 往下 `visualViewport.height` 那么高。

## 解法

手机外壳（`common/KeyboardShell.tsx`，算式在 `common/keyboard-frame.ts`）键盘在时只挪不缩：`top` 设成 `visualViewport.offsetTop`，把自己放到 WebKit 卷到的地方，尺寸不变；被键盘盖住的高度 `covered = 外壳高 - visualViewport.height` 经 `ShellKeyboardContext` 交给 `CallView`，它自己垫 `covered - env(safe-area-inset-bottom)`（它本来就停在底部安全区上方）。外壳外面套一层 `overflow: clip`：挪下去的外壳伸出页面底边，不裁掉就把文档拉长、WebKit 能卷得更多、外壳又跟着挪；用 `clip` 不用 `hidden`，后者仍是滚动容器，聚焦时会被 WebKit 卷。用 `top` 不用 transform，免得外壳变成里面 `fixed` 元素的包含块。iPad 第一次弹键盘也是这种做法，平板/桌面外壳套同一个 `KeyboardShell`，见坑 454。

外壳不能跟着缩到可见区域那么高：那样课堂底下挂着的 EPUB 阅读器跟着重排，模拟器上第二次在 EPUB 课堂里弹键盘时 React 报 update depth 超限、整个 app 白屏（PDF 课堂和简报对话不出）。确切的循环没能在模拟器外复现；只挪不缩之后，键盘变化只重渲 `KeyboardShell` 和读 context 的对话，别的都不重排也不重渲。
