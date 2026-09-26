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

手机外壳跟着可见区域走（`common/keyboard-frame.ts` 的 `keyboardFrame`，`PhoneApp` 用 `useKeyboardFrame`）：键盘在时，外壳根节点 `height` 设成 `visualViewport.height`、`top` 设成 `offsetTop`，去掉底部安全区；不和 WebKit 抢那次滚动，而是把自己放到它卷到的地方。用 `top` 不用 transform，免得外壳变成里面 `fixed` 元素的包含块。外壳经 `ShellKeyboardContext` 告诉 `CallView` 键盘已经让过了，`CallView` 不再自己加 padding（坑 392 那种只缩 visual viewport 的状态下，两边都让就是让两遍）。iPad 和桌面没有这个 context，照旧由 `CallView` 自己垫。

