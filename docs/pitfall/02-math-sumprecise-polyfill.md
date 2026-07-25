# mobile pdf.js 裸调 Math.sumPrecise

> zotero 引擎时代的坑，文中的宿主页和 polyfill 都不在了。同一类问题还在：WebKitGTK 落后于新内建，`src/fulltext/extract.ts` 现在要在加载 pdf.js 前补 `Promise.withResolvers`。

现象：文本层几何计算抛 TypeError，划词/标注浮窗的 rect 拿不到。

原因：view-web 用的是 mobile pdf.js 构建，它假设现代 JS 引擎、不带 polyfill 就裸调 `Math.sumPrecise`（reader 的 legacy web 构建才自带 polyfill）。

解法：宿主页在 view.js 之前补：

```js
if (typeof Math.sumPrecise !== 'function') {
  Math.sumPrecise = function (v) { let s = 0; for (const x of v) s += x; return s; };
}
```

已内置在 public/reader/reader-host.html。
