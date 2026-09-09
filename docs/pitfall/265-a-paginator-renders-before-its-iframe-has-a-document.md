# 分页器在 iframe 还没有文档时就被要求排版

现象：每开一本 EPUB，`window.onerror` 收到一次 `TypeError: null is not an object (evaluating 'doc.documentElement')`，栈是 `columnize@paginator.js:319 ← render@294 ← render@762`。首屏照常出来，界面上看不出任何异常。71 MB 那本还多一条 `Cannot destructure property 'documentElement' from null`，栈在 `expand@paginator.js:368`。iPad 模拟器上四次冷启动四次都有。

原因：`Paginator` 在构造 `View` 之后才异步给它的 iframe 装文档，而容器上的 `ResizeObserver`（`paginator.js` 的 `#observer = new ResizeObserver(() => this.render())`）在这中间就会响一次。`Paginator.render()` 只挡了 `if (!this.#view) return`，`View.render(layout)` 只挡了 `if (!layout) return`，往下 `columnize`/`scrolled` 直接读 `this.document.documentElement`，此刻是 null。`expand()` 同理，body 的观察器可以在文档换掉之后再响一次。

解法：`View.render()` 和 `View.expand()` 各加一条 `if (!this.document) return`（vendor `PATCHED:`）。这一次排版本来就无事可做——`load()` 在文档到位后自己会再排一次。异常抛在观察器回调里，不经过打开书的 await 链，所以它不是「首开卡 Rendering…」的原因（那条另说，四次冷启动没复现）。
