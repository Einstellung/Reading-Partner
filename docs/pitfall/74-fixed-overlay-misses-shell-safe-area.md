# 固定定位的浮层拿不到外壳那层安全区 padding

## 现象

iPhone 上设置页的标题行和 Done 按钮被灵动岛压住，toast 和 Retry 药丸落在 home indicator 上，未配置 provider 的引导卡片贴到屏幕边缘。而两个外壳（`App.tsx`、`PhoneApp.tsx`）都已经按 `env(safe-area-inset-*)` 给自己加了四边 padding。

## 原因

外壳的 padding 只管它的流内子元素。`position: fixed` 的包含块是视口，视口不是外壳，那层 padding 对它不存在；`fixed inset-0` 就是整块屏幕，含刘海和 home indicator 那两条。`absolute` 同族：包含块是最近定位祖先的 padding box，padding 那一圈照样是可落点的区域。

三处浮层是各自独立踩到的——「外壳已经处理过安全区」看起来像全局成立。

## 解法

`env()` 只写在 `src/styles.css` 一处，做成一组工具类，浮层自己申请：

```css
@utility pb-safe-* {
  padding-bottom: max(calc(var(--spacing) * --value(integer)), env(safe-area-inset-bottom));
}
```

取 max 而不是相加：没有安全区的设备上原来的间距要留住，有安全区时那条 inset 已经把间距吃进去了。相加会把 iPhone 上 24px 的间距变成 58px。

外壳用 `p-safe`（四边直接等于 inset，它本来就没有别的 padding）；浮层用 `pt-safe-10` / `bottom-safe-6` 这种带原有间距的形式，自己是一个画出来的盒子（药丸、卡片）时用 `bottom-safe-*` 而不是 padding，padding 会把盒子撑大。

按点定位的浮层用 `anchor-safe`，锚点写进 `--anchor-x` / `--anchor-y`，夹取在 CSS 里做：

```css
left: clamp(
  calc(env(safe-area-inset-left) + var(--spacing) * 2),
  var(--anchor-x),
  calc(100dvw - env(safe-area-inset-right) - var(--spacing) * 2 - var(--anchor-w))
);
```

夹在 CSS 里还顺手修掉一件事：原来的 JS 版本读 `window.innerWidth` 且不监听 resize，转屏后卡片就出界。

Tailwind v4 的自定义工具类走 `@utility`，功能型的（`-*`）用 `--value(integer)` 拿数字。加完 `bun run build`，在 `dist/assets/*.css` 里 grep 一下确认真的编出来了。
