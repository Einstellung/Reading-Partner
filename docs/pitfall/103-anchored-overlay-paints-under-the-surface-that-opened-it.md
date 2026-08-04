# 锚定浮层画在开它的那层底下

## 现象

设置页上每一个下拉框点开都完全看不见。iPad 实机（build 36 / 0.8.17）接 WebKit inspector 量：`data-state` 是 `open`，`[data-slot=select-content]` 已挂载，`getBoundingClientRect()` 是 820×1180 视口里的 526×450 @ (183, 442)，`opacity: 1`、`visibility: visible`，`document.elementFromPoint(400, 600)` 返回的是一个文字为「日本語」的 `select-item`。同一刻的真机截图那里什么都没有；把 content 底色改红、popper 包装节点改亮绿，再截，还是什么都没有。把包装节点的 `z-index` 从 50 改成 100，列表出现，位置正确，十种语言都在，Deutsch 打着勾。

用户报的是「下拉框点不动了，没法展开了」。它一直在展开，只是被盖住。

## 原因

`SettingsView` 的全屏页是 `fixed inset-0 bg-background`（不透明白）加 `z-[70]`，而所有锚定浮层都停在 shadcn 生成的 `z-50`（`ui/select.tsx`、`ui/dropdown-menu.tsx`）。70 压过 50，从这个页面里开出来的下拉就画在开它的那个页面底下。Radix 把 content 的计算 `z-index` 抄到它定位用的 popper 包装节点上，所以决定谁在上面的是 content 那个 class。

它看起来像「控件坏了」而不是「浮层被盖住」，是因为 Radix Select 开着的时候会给自己以外的一切加 `pointer-events: none`：盖住它的那个页面不拦任何东西，手指照样落在看不见的列表上。

不是 iOS 独有。任何引擎都复现，早先的浏览器检查只断言了 `data-state === "open"`，没人看它是否可见。

同因的还有：z-[80] 的 `SlidesDialog`、z-[1000] 的阅读区浮层（`CallBubble` / `PenToolbar` / `AnnotationPopup`），从它们里面开的任何 Select 或 DropdownMenu 都一样。

## 解法

一条命名的 z 阶梯，数字每层只写一次，放 `src/ui/components/ui/overlay.tsx` 的 `OVERLAY_Z`：toast 30、dialog 50、page 70、pageDialog 80、floating 1000、floatingTop 1001、anchored 1100。锚定浮层排在整条阶梯之上——触发它的按钮可以坐在阶梯上任何一层，这是唯一恒成立的位置。调用点不再自己写数字：全屏页的层级归 `DialogFullScreenContent` 自己，`SettingsView` 那个 `z-[70]` 删掉。

`tests/ui/components/overlay-z.test.tsx` 盯着：anchored 高过其余每一层，全屏页渲染出来带的就是 `OVERLAY_Z.page`，`src/` 里除 `overlay.tsx` 外不许再出现 `z-[...]`。

留一句给下次：`elementFromPoint` 打得中而屏幕上什么都没有，是画的顺序不对，不是输入不对。
