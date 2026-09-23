# 程序化跳页和阅读器自己的滚动是两个写 scrollTop 的人

## 现象

点目录条目、或点 AI 引用跳到某页之后，iPad 上手指在页面上滑动，页面完全不动，之后一直不动。跳转前正常，重开书也正常。

## 原因

两条，第一条实测，第二条是推断。

一，实测（Chromium 可复现）：跳转不会停掉触摸路由器手上还在跑的东西。惯性 fling 在手指抬起后还要写将近一秒的 `scrollTop`，`scrollToPage` 落到哪儿它就接着从哪儿往下滑。跳转发生在惯性期间时落点 613px，同一次干净跳转的落点是 2604px——跳转被自己的惯性覆盖掉了。`setLayout` 早就会先调 `resetGestures()`，跳转这条路上没人调。

二，推断（真机才有的现象，Chromium 四条跳转路径全试过，跳完都能正常滚）：`behavior: "smooth"` 把 `scrollTop` 交给浏览器自己的滚动动画。这个动画阅读器既看不见也停不掉——WebKit 把它派到 scrolling thread 上跑（`AsyncScrollingCoordinator::requestAnimatedScrollToPosition` / `stopAnimatedScroll`），而路由器每帧从主线程写同一个属性。页 div 在所有模式下都是 `touch-action:none`（坑 37），滚动本来就只能由路由器写，于是这是两个写者抢一个属性，和坑 41（transform 归缩放预览所有）、坑 45（浏览器夹紧 scrollTop 正好抵消掉平移）同一类。

读源码排掉的两条：EmbedPDF 的 `pageChangeState.isChanging` 在 `behavior:"smooth"` 下确实会一直挂着（只有一条 scroll-activity 订阅在 `isSmoothScrolling` 变 false 时清它），但翻遍 plugin 源码，它唯一的消费者是 `commitMetrics` 里把上报的 `currentPage` 钉死，没有任何地方拿它挡滚动。`viewport` 的 `gates`（只有 plugin-zoom 会加）挡的是 `Viewport` 渲不渲染 children，卡住的表现是白屏不是不能滚。

## 解法

所有宿主发起的跳转（outline、trace list、AI 引用）走同一个 `jumpToPage`：先 `resetGestures?.()` 掐掉路由器手上的一切（跟手、惯性、橡皮筋、captured pointer、暂停的引擎），再用 `behavior: "instant"` 落点。paged 下的宿主跳转同理，先 reset 再 `turnToPage(page, "instant")`。

手指翻页那条路不动：它的 smooth 就是翻页动画本身，而且手指刚刚已经把页面拖过去大半。如果真机上 paged 翻完第一页之后也滑不动了，那就是上面第二条推断成立，同一处也要改。

代价是跳转不再滑行，直接落点。要找回滑行，动画得由已经拥有 `scrollTop` 的那一层自己做（`vertical-gesture.ts` 的 rAF 已经在做惯性和回弹），不能再交回浏览器。

纯逻辑那一半在 `layout-modes.ts` 的 `applyJump`：跳转清掉 router 状态，但不碰 axis / zoom / fit-page 基线——它不是一次 layout 切换。
