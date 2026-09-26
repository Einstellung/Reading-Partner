# 437 指针捕获到路由元素的祖先上，路由收不到抬手

## 现象

手机 EPUB 翻页模式长按拖动划完一条线之后，再点任何地方都没反应：点标注不出弹窗，点按区不翻页，frame 上的 pointerdown 一条都收不到。只长按不拖（原地抬手）不出这事。

## 原因

`paged-view.ts` 起划时对 frame 调 `setPointerCapture`，而触摸路由（`attachTouchRouter`）挂在 frame 里面的 scroller 上。捕获之后这根指针的事件目标是 frame，不再经过 scroller，路由的 `fingers` 表里这根手指永远不抬起。下一根手指进来按两指算，走多指分支在捕获阶段被 `stopPropagation` 吞掉，而且多指锁要等全部手指抬起才解，于是之后所有触摸都被吞。挂在 scroller 上的 `touching` 计数也不归零，改字号的重排和邻章预载一直被推迟。

## 解法

捕获到路由所在的 scroller 上，和滚动模式捕获到自己的 scroller 一样。路由看得到这根手指的移动和抬起；它不会在划线途中翻页，因为它自己的长按（450ms）比划线的长按（500ms）先到，已经把这根手指从翻页状态机里放掉了（phase `off`）。
