# 点击弹窗要求宿主回喂 selectAnnotations

现象：用户点击一条已有标注，onSetAnnotationPopup 永远不触发，编辑弹窗弹不出来，像坏了一样。

原因：引擎 pointerdown 时先调宿主的 onSelectAnnotations（通知"用户点了这条"），然后检查该标注是否真的在引擎的选中集里，是才弹浮窗。宿主不回应，选中集就是空的。

解法：宿主必须回喂：

```js
onSelectAnnotations: (ids) => view.selectAnnotations(ids)
```

view-dev demo 就是这么接的。M2 实战踩到（App 一开始默认 no-op，点高亮无反应）。
