# 291 用 scaleY 把一条 SVG 描边压平，要么整条消失，要么变成一块板

## 现象

Lumen 的嘴要在「笑嘴」和「平线」之间变形。做法是一条二次曲线，两个端点都在 `mouthY` 上，控制点在下方，然后 `transform: scaleY(var(--lumen-mouth-curve))` 绕 `mouthY` 压：curve=1 是笑嘴，curve=0 端点不动、控制点回到线上，正好是平线。

curve=0 时嘴整个不见了。加 `vector-effect="non-scaling-stroke"` 保住线宽之后，嘴变成一块比笑嘴粗十几倍的深色横板。

## 原因

两件事。`scaleY(0)` 的矩阵不可逆，浏览器直接不画这个元素，和「画了一条零高的线」不是一回事。

`non-scaling-stroke` 的线宽单位是屏幕像素，不是用户单位。SVG 的 viewBox 是 1000 见方、元素只有 72 px 宽，`strokeWidth={9}` 本来是 0.65 个屏幕像素，换成 non-scaling 之后是 9 个屏幕像素——刚好是元素宽度的八分之一。

## 解法

不 morph，画三张图交叉淡入淡出：笑嘴一条、平线一条、张嘴一个椭圆，透明度由 `--lumen-mouth-curve` 和 `--lumen-mouth-mix` 分。重叠的那 280 ms 两条线叠在一起，位置几乎重合，看不出来。

要缩放的地方一律给一个不为零的下限（张嘴的椭圆是 `calc(0.24 + 0.76 * var(--lumen-mouth-open))`），别让任何一个轴到 0。
