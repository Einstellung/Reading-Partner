# 滚动插件的 bufferSize 决定预取窗口多宽，不决定它什么时候滑

## 现象

`defaultBufferSize` 从 1 调到 3，DOM 里常驻的页光栅从 9 张变 15 张，停顿却一点没挪窝：超过 16ms 的主线程任务落在 386/786/1186/1586… 毫秒，每个 400ms，两组数逐个对齐（次数 13 → 11，都在那批 400ms 边界上）。

## 原因

`BaseScrollStrategy.getVisibleRange`：

```js
start: Math.max(0, startIndex - this.bufferSize),
end:   Math.min(virtualItems.length - 1, endIndex + this.bufferSize - 1)
```

`endIndex` 已经是第一个起点越过视口下沿的页，所以 `bufferSize = 1` 时 `end = endIndex`——本来就提前了整整一页。加大 bufferSize 只是让窗口两头更宽；窗口仍然是滚过一个页边界滑一格，每滑一格，前沿恰好进来一张没光栅过的页。慢滚 demo 书正好每 400ms 越一个页边界，于是节律不动。

## 解法

这类停顿是"每张页都要现光栅"，只能把光栅移出主线程（坑 141），调 bufferSize 换不到。`defaultBufferSize` 留 1：再大只是让首屏多画几页（dcaedfb）。

量预取时当心 fixture 太小：demo 书 14 页，bufferSize 调到 6 停顿降到 8 次，调到 20 时整本已经预渲染完（39 张光栅），停顿只剩 2-3 次共 88ms——那不是预取的收益，是"全书画完了"。小 fixture 上的漂亮数字先确认窗口没吃掉整篇。

（以上都是 PDFium 还在主线程时量的。挪进 worker 之后同一条滚动上超过 16ms 的主线程任务是 0 个，bufferSize 也就无从比较。）
