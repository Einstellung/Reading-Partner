# foliate 的 `create-overlay` 发出来时，覆盖层还没挂上去

## 现象

标注要在换章后自己重画，挂点是 `view.js` 发的 `create-overlay` 事件（每加载一个 spine 项发一次，带 `index`）。在这个事件里立刻画，一条也画不出来：

```js
view.addEventListener('create-overlay', e => {
  const c = view.renderer.getContents().find(x => x.index === e.detail.index)
  c.overlayer      // undefined
})
```

翻回来再翻过去也不会补上——事件只发一次，那一次画空了就永远空着。

## 原因

`view.js` 里是这一行：

```js
this.renderer.addEventListener('create-overlayer', e =>
    e.detail.attach(this.#createOverlayer(e.detail)))
```

`#createOverlayer` 同步跑完（`create-overlay` 就是在它最后一行发的）才 return，`attach` 在那之后才把覆盖层交给渲染器。所以事件处理器读 `getContents()` 时，渲染器手里还是没有覆盖层的那份。foliate 自己在同一个函数里重放搜索结果不踩这条，是因为它走的 `addAnnotation` 是 async 的，`await resolveNavigation` 之后才读 `getContents()`。

## 解法

在事件处理器里 `queueMicrotask` 再画。`attach` 是同一个同步任务里的下一句，微任务就够，不用 `requestAnimationFrame`（那会晚一帧，换章时能看见空白）。

```js
view.addEventListener('create-overlay', e => {
  const index = e.detail?.index
  queueMicrotask(() => paintSection(index))
})
```
