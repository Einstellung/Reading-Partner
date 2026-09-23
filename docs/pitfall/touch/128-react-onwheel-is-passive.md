# React 的 `onWheel` 是 passive 的，里面 `preventDefault()` 不生效

## 现象

聊天窗口用 `onWheel` 接 ctrl+滚轮做内容缩放，在处理函数开头 `e.preventDefault()`。自己的缩放跑了，浏览器/webview 自己的页面缩放也跑了，两套叠在一起：字变大的同时整页也在放大。

## 原因

React 18 把事件挂在 root 容器上，其中 `wheel`、`touchstart`、`touchmove` 三个是显式按 passive 注册的（`react-dom/cjs/react-dom.development.js`，`addTrappedEventListener` 里对这三个名字置 `isPassiveListener = true`，注释说是为了保住浏览器把它们默认 passive 之后的性能收益）。passive 监听里的 `preventDefault()` 按规范被忽略。合成事件系统没有开口让调用方改这个标志。

不只是 wheel：任何要在这三个事件上阻止默认行为的地方，React 的 props 都做不到。

## 解法

自己挂原生监听，非 passive，卸载时摘掉：

```ts
const el = hostRef.current;
const onWheel = (e: WheelEvent) => { ... e.preventDefault(); ... };
el.addEventListener('wheel', onWheel, { passive: false });
return () => el.removeEventListener('wheel', onWheel);
```

`{ passive: false }` 要显式写：滚轮类事件在多数引擎上默认就是 passive。
