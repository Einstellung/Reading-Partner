# 返回手势带吃掉了翻页点击

## 现象

手机 EPUB 翻页模式，点左边缘 24px 以内什么都不发生：iPhone 模拟器实测 x=12、22 点一下不翻页，x=30 翻。左侧 28% 本该是「上一页」。

## 原因

`paged-view.ts` 为了不让左缘右滑变成翻上一页，在 frame 的捕获阶段对 `backEdgePx`（`EDGE_ZONE`，24）带内起手的触摸整条 `stopPropagation`：翻页路由收不到，按压状态机（`flow-gesture.ts`）也收不到。外壳的返回手势（`useEdgeBack`）只认横向拖动，点一下它不认。这条带子于是谁都不管点击。

## 解法

带内触摸仍在 frame 捕获阶段挡住，不让路由看见（拖出去还是返回，不会翻页），但把 pointer 事件直接喂给按压状态机：落点不找 caret（带内不起划线），slop 用滚动模式的 `PRESS_SLOP_PX`（外壳 10px 接管拖动时不打招呼，走出 8px 即不算点击）。抬手是点击就按 `tapZone` 翻上一页。

外壳接管拖动后会把指针捕获到自己身上，抬手不再回到 frame，状态机停在 released。所以 `pressStep` 在 pressed/released 下收到新的 primary down 时按新一次按压处理，不再等那个永远不来的 up。
