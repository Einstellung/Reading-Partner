# foliate 的 `gap` 少写一个 `%`，正文行宽的上限整条消失

## 现象

EPUB 阅读面板按 foliate 的属性设了 `max-inline-size` 和 `max-column-count: 1`，指望正文行宽被压到 720px 左右。在 WebKitGTK 里量出来：1280px 的窗口下 `column-width` 是 `1198px`，一行一百二十个字符，横跨整个屏幕。

翻页模式（`flow: paginated`）下才这样；滚动模式正常。属性明明设了，从 JS 那边读回来也是对的数。

## 原因

不是 `max-inline-size` 不管用——是同一批属性里的 `gap` 写成了不带单位的 `"6"`。

`paginator.js` 把每个属性写成 shadow DOM 上的一个自定义属性（`--_gap`、`--_margin`、`--_max-inline-size`…），然后**读两遍**：

```js
const g = parseFloat(style.getPropertyValue('--_gap')) / 100   // JS 这一遍
```

```css
--_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
grid-template-columns:
    minmax(var(--_half-gap), 1fr)
    var(--_half-gap)
    minmax(0, calc(var(--_max-width) - var(--_gap)))   /* CSS 这一遍 */
    var(--_half-gap)
    minmax(var(--_half-gap), 1fr);
```

中间那条轨道就是行宽的上限。`--_gap: 6` 让 `calc(720px - 6)` 变成长度减数字——非法，整条 `grid-template-columns` 声明作废，容器于是撑满窗口，栏宽跟着变成满宽。

JS 那一遍不受影响（`parseFloat("6")` 和 `parseFloat("6%")` 都是 6），所以属性看起来是生效的，只有排版是错的。上游默认值 `--_gap: 7%` 本来就是百分比：gap 是容器宽度的一份，不是一个长度。

一次隔离量的，同一台机器同一本书，1280px 窗口：

| 写法 | 容器宽 | `column-width` |
|---|---|---|
| 全部带单位（`6%` / `48px` / `720px`） | 720 | 674px |
| 三个都不带单位 | 1280 | 1198px |
| **只有 `gap` 不带单位** | 1280 | 1198px |
| 只有 `margin` 不带单位 | 720 | 674px |

`margin` 不带单位不影响行宽（它只进行方向的轨道和页眉页脚的 `height`），但同样是无效 CSS，页眉页脚的高度会掉回 `auto`。

## 解法

`RENDERER_GEOMETRY`（`src/reading/epub/reader-styles.ts`）里每个值按属性各自的用途带单位：`gap` 用 `%`（`--_gap` 被 `/100` 当百分比用），`margin`、`max-inline-size`、`max-block-size` 用 `px`，`max-column-count` 本来就是无单位整数。行宽的上限就是那条轨道 `max-inline-size × max-column-count`。

同一个错在 iPad 模拟器上的样子：滚动模式正文 456px、翻页 674px，`#top` 的 `grid-template-columns` 量出来是 `456px 156px 156px`——不是 `paginator.js` 写的五条轨道，是声明作废后 `#container` 的 `grid-column: 2 / 5`（翻页）和 `1 / -1`（滚动）落在隐式轨道上，两种流各得一个跟内容有关的宽度。

带对单位之后两个模式仍差 4px（滚动 670、翻页 674）：翻页从 `size` 里扣一个 gap，滚动从另一个宽度的容器里扣两个。gap 设 `0%`、留白改成 `<foliate-view>` 元素上的 `padding-inline`，两边就都是 720px——留白挪到了两种流共同的外面。
