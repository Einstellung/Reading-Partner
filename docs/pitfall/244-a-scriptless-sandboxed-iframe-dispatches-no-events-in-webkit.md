# WebKit 里不给 `allow-scripts` 的 sandbox iframe，一个 DOM 事件都不派发

## 现象

EPUB 的正文文档装在 `sandbox="allow-same-origin"` 的 iframe 里（不给 `allow-scripts`，因为书里可以带 JavaScript，同源加脚本等于书拿到 app 的权限）。父页有 `contentDocument`，能读能改，能拿 `Range`，能算 CFI。但父页在那个 document 上装的监听器收不到任何东西：

```js
cd.addEventListener('click', () => seen++)
cd.getElementById('p').dispatchEvent(new MouseEvent('click', { bubbles: true }))
// seen === 0
```

同一段代码，把 sandbox 改成 `allow-same-origin allow-scripts`、或者干脆不写 sandbox 属性，`seen === 1`。

在 iPad Pro 11-inch (M5) 模拟器 / iOS 26.5 的 WKWebView 和 Ubuntu 的 WebKitGTK（Version/60.5）上结果一致。

## 原因

WebKit bug 218086。sandbox 关掉脚本的同时把事件派发一起关了，不区分事件源是页面里的脚本还是外面的宿主。foliate-js 的 `paginator.js` 因此在上游就写着 `allow-same-origin allow-scripts`，注释直接引了这个 bug 号。

## 解法

没有绕过。这条约束决定了架构：**书的 iframe 里不能靠事件干任何事**。

- 点击翻页、笔手路由、高亮命中测试（`overlayer.hitTest(event)`）都要在父页的容器上做，用坐标换算进 frame，不能在 frame 的 document 上监听。
- 系统自己的东西不受影响：长按仍然出 iOS 选区手柄和 callout，选区仍然落在 frame 的 document 上，父页 `cd.getSelection()` 读得到（实测有值）。所以「选中一段文字变成标注」这条路还在，走的是轮询/父页手势，不是 frame 里的 `selectionchange`。
- 想恢复事件就只能给 `allow-scripts`，那就必须先有一道消毒把书里的 `<script>` 和 `on*` 删干净，安全性从"浏览器保证"降级成"我们的清洗代码保证"。这个取舍见 docs/62。
