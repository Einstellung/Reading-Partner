# Radix 的对话框把滚动锁放在 Overlay 上，不在 Content 上

## 现象

全屏的设置页用 `Dialog` + `modal={true}`，但不渲染 `DialogOverlay`（一个铺满不透明的页面后面没有东西可以调暗）。打开后量 `body`：

```
overflow: visible   data-scroll-locked: 无   <head> 里没有注进去的 <style>
pointer-events: none
```

只有 `pointer-events` 被改了。同一份代码里居中的 `DialogContent` 带 Overlay，打开时 `overflow: hidden`、`data-scroll-locked` 在、`<head>` 多一个 `<style>`。

## 原因

`DialogOverlay` 的实现里包着 `RemoveScroll`：

```jsx
<RemoveScroll as={Slot} allowPinchZoom shards={[context.contentRef]}>
```

`modal` 只决定 `DialogContentModal` 那条分支——焦点陷阱、`hideOthers` 的 `aria-hidden`、`disableOutsidePointerEvents`。滚动锁不在里面。不渲染 Overlay 就没有 `RemoveScroll`，`modal` 是真也没用。

## 解法

想清楚要的是哪几件，再决定渲不渲染 Overlay。

全屏页不要 Overlay：它自己盖住整个视口、自己带滚动容器，底下没有东西需要锁；少了 `RemoveScroll` 也就少了 `body` 上的 `overflow`、`data-scroll-locked`、注进 `<head>` 的 `<style>` 和滚动条补偿，收尾要还原的东西更少。焦点陷阱和 Escape 照旧由 `modal` 给。

浮在东西上面的对话框要 Overlay：底下的阅读区必须停住。

实测（开→关一轮，Chromium 鼠标与触摸各一遍）两条路都干净：`window.scrollY` 三次读数相同、里层滚动容器的 `scrollTop` 相同、`padding-right` 全程 0、兄弟节点的 `aria-hidden` 撤干净，唯一残留是 `body` 上一个空的 `style=""`（和第二版的 AlertDialog 一样）。
