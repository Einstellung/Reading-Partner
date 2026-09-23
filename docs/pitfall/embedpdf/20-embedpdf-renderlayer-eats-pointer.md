# EmbedPDF RenderLayer 的 img 吃掉指针事件，划词失效

现象：页面渲染正常，但拖选划词没反应——`selection.getSelectedText()` 抛 "No Selection"，`onSelectionChange` 不触发，高亮工具拖过文字也建不出批注。`document.elementFromPoint(x, y)` 落在页面区域时返回的是 `<img>`（页面位图），不是文字/选择层。

原因：`renderPage` 里 `RenderLayer` 渲染的页面位图 img 默认 `pointer-events: auto`，盖在选择层上把指针事件都截了，`PagePointerProvider` / `SelectionLayer` 收不到。

解法：给 RenderLayer 关掉指针：

```tsx
<RenderLayer documentId={id} pageIndex={i} style={{ pointerEvents: "none" }} />
```

之后 `elementFromPoint` 命中选择层，划词、`getSelectedText()`、高亮/下划线建注、点已有批注全部正常。
