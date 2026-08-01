# 手指滑动时 WebKit 自己起了一次原生选区，整页变蓝还弹出系统菜单

## 现象

iPad 上单指滑动翻页，偶尔整页文字变蓝，页面上浮出系统的 `Copy | Look Up | Translate | Search Web | Share…` 条，选区角上一个圆形蓝把手。不停顿、快滑也照样出现。

## 原因

页面上有两套会把整页刷蓝的机制，这次是第二套。引擎的选区是自己画的：`plugin-selection` 的 TextSelection 拿 PDFium 字形几何算出矩形，渲染成绝对定位的 div，从不碰 DOM Selection，系统菜单和把手它画不出来（引擎侧那条"滑动后留活 anchor 凭空起选"是坑 38 的补充部分）。系统菜单和把手只能来自 WebKit 自己的原生选区。

阅读区里没有任何 DOM 文本——页面是 blob `<img>` 光栅，选区层和标注层都是 div——但没有文本不等于不能起选。WebKit 判"这个点能不能开始选"只看命中元素 `user-select` 的**用值**：`PositionInformationForWebPage.mm` 的 `selectabilityForPoint` 里，只有 `usedUserSelect() == UserSelect::None` 才返回 `UnselectableDueToUserSelectNoneOrQuirk`；`WKContentViewInteraction.mm` 的 `textInteractionGesture:shouldBeginAtPoint:` 和 `hasSelectablePositionAtPoint:` 也只认这个值来拒绝 loupe（长按起选）手势。全 app 没有一处写 `user-select`，阅读区一直是 `auto` = 可选，loupe 手势随时能开始。

快滑也中招，是因为本该取消它的那条路在本项目里是死的：页 div 在所有模式下都是 `touch-action:none`（坑 37），WKWebView 的 scroll view 永远不 pan——滚动是触摸路由器自己写 `scrollTop` 做的——所以 WebKit 里"scroll view 正在 pan 就放弃"这类判断永远不成立。系统手势的时间门槛本来就低（同一族的 `WKImageAnalysisGestureRecognizer` 是 `minimumPressDuration = 0.1`），落指到起滑之间那一百来毫秒足够。

和坑 43 同族，但**结局相反**：43 那条是 preflight 自带的，项目引入 preflight（`src/styles.css`）之后自动没了；这条 preflight 管不着。核对过 `node_modules/tailwindcss/preflight.css` 全文：它没有一条 `user-select`、也没有一条 `-webkit-touch-callout`。所以下面的手写规则引入 preflight 之后仍然必需，删掉阅读区的原生选区就会复活。

顺带排掉了 Live Text（图片 OCR）：`imagePositionInformation` 只在命中节点本身是 `HTMLImageElement` 时才置 `isImage`，而页面光栅是 `pointer-events:none`（坑 20），命中测试根本不返回它，`shouldAnalyzeImageAtLocation` 走不到。

## 解法

阅读区根节点（`EmbedPdfView` 最外层 div）挂 `data-reader-surface`，`src/styles.css` 里关掉原生选区和 callout：

```css
[data-reader-surface] {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
```

`user-select: none` 是真正拦住起选的那条；`-webkit-touch-callout: none` 是另一道门（WebKit 单独读成 `info.touchCalloutEnabled`），关掉长按菜单本身。

一条根规则就够，不需要 `[data-reader-surface] *`：`user-select: auto` 的用值继承自父元素，整棵子树跟着不可选。Chromium 实测：同一段文本放进 `[data-reader-surface]` 里拖不出选区，放在外面能选。

不会伤到引擎的选区，三条路径都不经过 DOM Selection：划词高亮走 pointerdown/move/up 打 PDFium 字形；双击选词走 DOM 的 `dblclick` 事件（interaction-manager 把 `dblclick` 映射到 `onDoubleClick`，`user-select` 不影响 click/dblclick）；复制走 `selection.copyToClipboard()` 取 PDFium 文本再 `navigator.clipboard.writeText`。Chromium 实测规则生效后拖选出 40 个 rect、双击出 1 个 rect，全程 `getSelection()` 为空。

范围只到阅读器。聊天、笔记、文章阅读器的文本在这棵子树外面，照常可选。
