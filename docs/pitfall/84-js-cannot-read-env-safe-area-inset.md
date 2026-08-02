# JS 读不到 `env(safe-area-inset-*)`

## 现象

锚定型浮层要把安全区当成数字交给 Radix 的 `collisionPadding`。想当然的写法：

```css
:root { --sa-top: env(safe-area-inset-top); }
```

```js
getComputedStyle(document.documentElement).getPropertyValue("--sa-top");
```

拿回来的是字符串 `"env(safe-area-inset-top)"`，不是 `"59px"`。`parseFloat` 得 `NaN`，一路当 0 用，浮层照样压在灵动岛下面。

## 原因

自定义属性的值在计算值阶段不做替换，`getComputedStyle` 交回的是原样的 token 流。`env()` 只在这个自定义属性被某个真属性引用、解析那个属性时才求值。同理 `var()` 套 `env()` 也读不出来。

## 解法

让某个真属性吃掉它，再读那个属性的计算值。一个不占位、不绘制的探针元素：

```css
@utility safe-probe {
  position: fixed; top: 0; left: 0; width: 0; height: 0;
  visibility: hidden; pointer-events: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
}
```

```ts
const probe = document.createElement("div");
probe.className = "safe-probe";
document.body.appendChild(probe);
const insets = insetsFromPadding(getComputedStyle(probe));
probe.remove();
```

`src/ui/components/common/safe-area.ts`。一次调用一次强制布局，所以只在挂载和 `resize` / `orientationchange` 时量，量到的值相同就不 setState。

能在 CSS 里夹取的浮层不要走这条路：居中型的 `overlay-safe` 和贴边型的 `bottom-safe-*` 都是纯 CSS，旋转和键盘弹出自己重算，不需要监听。只有夹取逻辑在 JS 里的（Radix popper）才需要把 inset 送进去。

副作用：`env()` 写在 CSS 里，探针也就跟着桌面验证那套改造走——把 dist 里的 `env(safe-area-inset-*)` 换成 `var(--sa-*, 0px)` 之后，驱动脚本设四个自定义属性，探针量到的就是设进去的值。写成行内样式就绕开了改造，验不了。
