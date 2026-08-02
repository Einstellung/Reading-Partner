# Portal 出去的浮层，第一按就被宿主的「点外面就关」吃掉

## 现象

`CallBubble` 头部的删除按钮换成 AlertDialog 之后，点垃圾桶，对话框正常弹出；点上面的 Cancel 或 Delete，气泡整个消失，删除没有发生，对话框跟着一起没了。桌面和触摸都一样。

## 原因

气泡自己有一条 document 上 capture 阶段的 `pointerdown`：落点不在 `ref.current` 里就 `onClose()`。Radix 的对话框走 Portal 渲染到 `<body>` 底下，不在那个 ref 里，于是按在 Cancel 上的那一下被判成「按在外面」。气泡先 unmount，`DeleteThreadButton` 跟着 unmount，对话框还没等到 click 就没了。

`AnnotationPopup`、`PenToolbar`、`MoreMenu`、`SourcesPage` 的 HealthDot 都是同一条监听，同一个后果。

实测对照（同一段脚本，两份产物）：

| | 打开 | 按 Cancel | 按 Delete |
|---|---|---|---|
| 有保护 | 气泡在 | 气泡在，未删 | 删除执行一次，气泡在 |
| 无保护 | 气泡在 | 气泡关闭，对话框消失 | 到不了这一步 |

## 解法

不用 DOM 归属判，用一个全局计数：有浮层开着的时候，任何一按都属于那一层。

```ts
// common/overlay-layer.ts
let openLayers = 0;
export function pushOverlayLayer(): () => void { ... }   // 返回自己的 release
export function overlayLayerOpen(): boolean { return openLayers > 0; }
```

浮层内容里挂一个不渲染 DOM 的 `<OverlayLayer />`（`ui/overlay.tsx`），在 effect 里加一、cleanup 里减一。要放在 Portal 里那棵子树上，不能放在 `AlertDialogContent` 函数顶层——后者一直在 React 树上，真正随开关挂载卸载的是 Portal 那棵。

每个「点外面就关」的监听开头加一句：

```ts
if (overlayLayerOpen()) return;
```

计数而不是 `closest('[data-overlay]')`：要挡住的不只是内容本身，还有背板、popper 的包装节点，以及退场动画期间还挂着的那一份。
