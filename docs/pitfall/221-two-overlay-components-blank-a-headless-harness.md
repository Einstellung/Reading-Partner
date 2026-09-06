# 无头 Chrome 里挂 PenToolbar 或 MoreMenu，整棵树白屏

## 现象

为核对配色做一个一次性静态探针页（`vite build` 出静态产物 + 静态 http server + `--headless=new --screenshot`，按坑 142 和 218 的做法），页面只画出背景色，React 树一个节点都没有。控制台两行：

```
Error: Minified React error #185 (Maximum update depth exceeded)
Uncaught Error: Minified React error #185
```

按节区逐个渲染，白屏的只有两个节区：含 `PenToolbar` 的（`ReaderTopBar` 里嵌了一个，所以顶栏节区一起白）和含 `MoreMenu` 的。`AnnotationPopup`、`Sidebar`、`OutlineView`、`MessageList`、设置卡片、卡片组全部正常。

## 原因

未定。栈顶指向 `PenToolbar` 那个布局 effect 里的 `setPalettePos(null)`（`paletteOpen` 为 false 的提前返回那一支），它的依赖是 `[paletteOpen, horizontal, viewport, margin]`。排除过的：把探针传进去的 props 全部提到模块常量（内联对象每次渲染换标识确实会造成一轮这样的循环，改完顶栏和笔工具仍白）；给 `.safe-probe` 钉 `padding: 0px !important`（怀疑 `useOverlaySafePadding` 在无头下量出不可解析的值，钉完没变）。两个组件唯一的共同点是都吃 `useOverlaySafePadding()`。

真机和桌面 webview 里这两个组件都是好的，这条只在无头 Chrome 复现。

## 解法

探针页别放这两个组件。它们的颜色本来就已经全是 token（第五版 shadcn 迁移做完的），配色改动落不到它们身上，用别的节区核对同类 token 即可。

真要在无头下看它们，先花时间把 #185 定位掉，别绕。
