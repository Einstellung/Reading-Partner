# openZip 的 text() 只答 markup 条目

## 现象

把生成的 `cover.svg` 打进 EPUB，`zip.entries` 里列着它，`zip.has("cover.svg")` 为 true，`zip.text("cover.svg")` 返回 `null`。单测里看着就像这个条目根本没写进去，于是去查打包那一段，那一段没问题。

## 原因

`src/reading/epub/zip.ts` 的 `openZip` 开包时只解一次，`filter` 里用 `isMarkup(name)` 挑出 markup 条目预先解压，`text()` 只从那张表里查；其余条目留给 `bytes()` 按需再解一次。SVG 不在 markup 之列。查不到不区分「条目不存在」和「条目没预解」，两种都是 `null`。

## 解法

非 markup 条目一律 `zip.bytes(name)` 取字节自己 decode。书架取封面（`epub-cover.ts`）走的就是 `bytes()`，只有测试容易顺手写成 `text()`。
