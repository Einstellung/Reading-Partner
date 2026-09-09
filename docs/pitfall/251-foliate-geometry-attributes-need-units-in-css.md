# foliate 的几何属性不带单位，影子样式表的 grid 整条失效，两种流各排各的宽

## 现象

iPad 模拟器上打开 EPUB，滚动模式正文只有 456px 宽，翻页模式 674px，同一本书两个宽度。`foliate-view` 元素两边都是 768px。

量 `#top` 的 `grid-template-columns`：

```
456px 156px 156px
```

那不是 `paginator.js` 写的模板。它写的是五条轨道。

## 原因

坑 247 把 `RENDERER_GEOMETRY` 的每个值都写成了不带单位的数字。`attributeChangedCallback` 把属性值原样塞进自定义属性：`--_max-inline-size: 720`、`--_gap: 6`、`--_margin: 24`。

这些自定义属性有两个读者。JS 那边 `parseFloat` 读，不带单位正好。CSS 那边影子样式表自己也读：

```css
--_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
grid-template-columns:
    minmax(var(--_half-gap), 1fr)
    var(--_half-gap)
    minmax(0, calc(var(--_max-width) - var(--_gap)))
    ...
```

`calc(720 * 1)` 是个数不是长度，`calc(720 - 6)` 同理，`minmax(calc(6 / 2), 1fr)` 也是。整条 `grid-template-columns` 因此非法，计算值退回 `none`，五条显式轨道全没了。`#container` 上的 `grid-column: 2 / 5`（翻页）和 `1 / -1`（滚动）于是落在隐式轨道上，两种流各得一个跟内容有关的宽度——这才是两个模式宽度不一致的根，不是留白规则不同。

`parseFloat("720px")` 是 720，`parseFloat("6%")` 是 6。带对单位两边都对。坑 247 说的"一律不能带单位"只对 `em` 成立（`parseFloat("40em")` 是 40，按像素用就错了），不能推广。

## 解法

按属性各自的用途给单位：`gap` 用 `%`（`--_gap` 被 `/100` 当百分比用），`margin`、`max-inline-size`、`max-block-size` 用 `px`，`max-column-count` 本来就是无单位整数。

修好之后两个模式仍差 4px（滚动 670、翻页 674）：翻页从 `size` 里扣一个 gap，滚动从另一个宽度的容器里扣两个。gap 设 0、留白改成 `<foliate-view>` 元素上的 `padding-inline`，两边就都是 720px——留白挪到了两种流共同的外面。
