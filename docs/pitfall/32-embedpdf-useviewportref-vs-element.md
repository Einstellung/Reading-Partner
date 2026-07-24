# EmbedPDF useViewportRef 不是读现有视口的，读要用 useViewportElement

现象：想在一个渲染进 `<Viewport>` 里的子组件上拿到滚动容器 DOM（给它挂 pointer 监听、改 touch-action、直接读写 scrollLeft），调 `useViewportRef(documentId)` 拿到的 ref 的 `.current` 永远是 null。等它的副作用（挂监听、设 touch-action）从不生效，页面上看不到任何变化。

原因：`useViewportRef` 内部 `const containerRef = useRef(null)` 每次调用都新建一个 ref，语义是“把这个 ref 挂到你自己渲染的某个 div 上，我来给它注册滚动/resize 观察”。`<Viewport>` 组件自己调了一次并把那个 ref 挂在了 `overflow:auto` 的滚动 div 上，再通过 `ViewportElementContext` provide 给子树。你在子组件里再调一次 `useViewportRef` 得到的是另一个从没挂到任何 DOM 上的 ref，`.current` 自然一直是 null。

解法：读现有滚动容器用 `useViewportElement()`（`@embedpdf/plugin-viewport/react`），它 `useContext(ViewportElementContext)`，返回 `<Viewport>` 挂好的那个 ref，`.current` 就是滚动容器 div。注意它在视口 div 挂载后才有值，首帧可能仍是 null——用 requestAnimationFrame 轮询到 `.current` 再挂监听。

```ts
const vpRef = useViewportElement(); // RefObject<HTMLDivElement> | null
useEffect(() => {
  let raf = 0;
  const wait = () => {
    const el = vpRef?.current;
    if (el) { attach(el); return; }
    raf = requestAnimationFrame(wait);
  };
  wait();
  return () => cancelAnimationFrame(raf);
}, [vpRef]);
```

分页横翻模式（`src/reader-embedpdf/EmbedPdfView.tsx` 的 `PagedGestures`）靠这个拿到滚动容器跟手改 scrollLeft、锁 touch-action。
