# 从浮层里开的确认框画在那个浮层底下

## 现象

iPad 实机 0.12.0。阅读器里对一段划线开的 AI 弹层（标题 "Reading with AI"），点标题栏的垃圾桶，Cancel / Delete 确认框出来了，但画在弹层底下，被盖住一半：屏幕上只剩 Delete。点 Cancel 没反应，点框外面也关不掉，唯一还能按的出口是那个不可撤销的。

## 原因

两件事叠在一起。

一、确认框停在 z 阶梯的 dialog 那格。`CallBubble` 是 `OVERLAY_Z.floating`（1000），AlertDialog 的 content 和 backdrop 写死 `OVERLAY_Z.dialog`（50）。坑 103 立阶梯时把锚定浮层提到整条阶梯之上（触发器可以坐在任何一层），对话框没有跟着走：它的层级按"谁开的"算，而阶梯上没有一格是给"从浮层里开的对话框"的——`pageDialog` 是给全屏页的那一格，一直没人用。两边都是 `fixed`，也都在根堆叠上下文里（外壳是 `flex flex-col h-full p-safe`，`<main>` 只有 `relative` 没有 z-index，手机壳那个 transform 静止时清掉，坑 41），所以纯按 z 比大小，1000 压 50。

二、AlertDialog 本来就不给点外面关。`@radix-ui/react-alert-dialog` 在 Content 上写死 `onPointerDownOutside: (e) => e.preventDefault()` 和同样的 `onInteractOutside`，而且写在展开调用方 props 之后，外面覆盖不掉。桌面还剩 Escape，iPad 没有。Cancel 一被盖住，这个框就真的没有出口了。

还有一件反直觉的：模态框开着时 Radix 把 `document.body` 的 `pointer-events` 设成 `none`，只给自己那层设回 `auto`，所以被盖住的 Cancel 在命中测试上其实是通的（弹层整棵子树对指针透明）。"点不动"里有一部分是"看不见所以点不准"。反过来说，判断画的顺序对不对只能看屏幕，`elementFromPoint` 打得中说明不了任何事（坑 103 那句反过来也成立）。

## 解法

阶梯加一格 `floatingDialog: z-[1050]`，排在 floating（1000）和 floatingTop（1001）之上、anchored（1100）之下：模态框身上不该还留着够得着的控件，而框里开出来的 Select 得在框之上。

选哪一格不由调用点写，也不由对话框自己猜——它 Portal 到 `<body>`，DOM 位置说明不了是谁开的。由**面**声明：`ui/overlay.tsx` 出一个 `OverlaySurface layer="floating"`，`CallBubble` 把自己整棵子树包进去；`DialogContent` / `AlertDialogContent` 和它们的 backdrop 各自 `useDialogLayer()` 取值。context 跟 React 树走，Portal 挡不住，所以以后往任何浮层里再放对话框都自动落对格。backdrop 也得跟着抬——夹在两者中间的暗片就是同一个 bug 小一号。

点外面关不掉那半没动：Radix 覆盖不掉，iOS 系统 alert 也是点外面不关。Cancel 露出来之后这个框就有出口了。

护栏在 `tests/ui/components/overlay-z.test.tsx`：真渲染一次，断言 floating 面里开的确认框 content 和 backdrop 都落在 floatingDialog、面外的还落在 dialog，另加阶梯上下界和 `CallBubble` 确实声明了自己那格。
