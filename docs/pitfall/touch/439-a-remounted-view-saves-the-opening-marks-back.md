# 439 切换滚动/翻页时新视图拿开书时的标注，存回去就删掉了中途划的线

## 现象

手机 EPUB 里划一条线，切到另一种模式，那条线不见了；再划一条，盘上的标注数不增，前面那条被删掉了。

## 原因

`PhoneReader` 传给阅读区的 `annotations` 是开书时的 `book.annotations`。模式一变 `FlowReaderPane` 销毁旧视图、按 props 挂新视图，新视图拿到的是开书时的列表。视图存标注时交出自己的全部页面标注，`mergeSavedMarks` 以它为准替换盘上的页面标注，于是开书之后划的线（和删掉又回来的线）按新视图的列表被覆盖。

## 解法

`PhoneReader` 传 `pageMarks(marksRef.current)`：每次渲染取当前的全部标注，模式切换时新视图挂的是此刻的列表。
