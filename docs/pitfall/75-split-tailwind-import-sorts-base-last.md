# 拆开 import 的 Tailwind 里，preflight 排在 utilities 后面，反过来压过每一个 utility class

## 现象

在 `src/styles.css` 里按官方写法加一行 `@import "tailwindcss/preflight.css" layer(base);`，构建出来的 app 里所有按钮变成 `border: 0`、所有输入框变成透明底——即使组件上写着 `border border-[#dcdcdc] bg-white`。utility class 出现在产物里，选择器也命中，就是不生效。

## 原因

CSS 的 layer 顺序按**第一次出现**的位置定，不按名字。`@import "tailwindcss"` 的第一行就是 `@layer theme, base, components, utilities;`，这行声明把顺序钉死了；本项目为了不引 preflight 早就把它拆成了 `theme.css` + `utilities.css` 两条 import，那行声明也就跟着丢了。

丢了以后顺序由文件里的物理位置决定。实测（未加声明的一次构建）：产物里 `@layer utilities{` 在偏移 4551，`@layer base{` 在 45115——base 在后，于是同等特异性下 preflight 的 `button { border: 0 solid }` 赢过 `.border`。层内特异性在这里不起作用：层与层之间先比层序，层序比完了才轮到特异性。

## 解法

在所有 import 之前写出完整的声明，四个都要列（`components` 现在是空的，但漏掉它 shadcn 迁移时会再踩一次）：

```css
@layer theme, base, components, utilities;

@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css" layer(utilities);
```

`@layer` 声明和 `@charset` 一样，是 CSS 允许出现在 `@import` 之前的少数几条之一。

验收看产物，不看源文件——Lightning CSS 会把声明化掉，只留下按序排布的 layer 块：

```
grep -o '@layer [a-z, ]*[{;]' dist/assets/index-*.css
```

第一次出现的顺序必须是 `theme` → `base` → `utilities`（前面还会有 Tailwind 自己的 `@layer properties{`，那是注册 `--tw-*` 自定义属性的，不参与这件事）。

顺带：`src/styles.css` 底部那几条全局规则（`html/body/#root` 的高度、`overscroll-behavior-x`、`[data-reader-surface]` 的 `user-select`）是**无层**的。无层规则赢过所有分层规则，所以它们不需要 `!important`，也不会被 preflight 盖掉。文章正文的 `<style>`（`proseCss.ts`）同理。
