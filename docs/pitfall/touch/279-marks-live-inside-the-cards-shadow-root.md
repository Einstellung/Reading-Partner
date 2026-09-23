# 279 标注层在卡片的 shadow root 里，光 DOM 查不到

## 现象

探针里 `pane.querySelectorAll(".rp-marks > *").length` 一直是 0：手指拖出高亮之后是 0，重开书之后还是 0，盘上 `annotations-<bookId>.json` 却实实在在多了三条，书架卡片上的 marks 计数也跟着涨。据此报「标注不画」是错的。

## 原因

`.rp-overlay` 和它的 `.rp-marks` / `.rp-quote` 两个子层挂在页卡片的 shadow root 里（`page-card.ts`）。`querySelectorAll` 不穿 shadow 边界，宿主 `.rp-page` 之下的东西一个都数不到。

## 解法

数标注要逐张卡片进 shadow root：

```js
[...pane.querySelectorAll(".rp-page")].map(c => c.shadowRoot.querySelector(".rp-marks")?.childElementCount)
```

同一本书同一页，这么数出来是 3。凡是「盘上有、界面上没有」的结论，先确认查询穿没穿 shadow root。
