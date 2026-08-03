# renderPage 的 imageQuality 完全不起作用，编码器读的是另一个名字

## 现象

给封面缩略图调 JPEG 质量：`renderPage(doc, page, { imageType: "image/jpeg", imageQuality: q })`，q 从 0.01 一路调到 1.0，出来的 Blob 每次都是同一个字节数（240×311 的首页固定 24795 字节）。`imageType` 是生效的——Blob 的 type 是 `image/jpeg`，magic 是 `ff d8 ff`，换 `image/png` 会变成 33232 字节。只有质量这一项像不存在。

对照：同一批像素（`renderPageRaw` 出来的 ImageData）画进 canvas 再 `toBlob("image/jpeg", q)`，0.1 是 4600 字节、0.5 是 10121、0.8 是 16271、1.0 是 45727。24795 落在 canvas 默认的 0.92 附近。

## 原因

`@embedpdf/engines` 2.14.4 的 orchestrator 在 `encodeImage` 里读错了字段名：

```js
encodeImage(rawImageData, options, resultTask) {
  const imageType = options?.imageType ?? "image/png";
  const quality = options?.quality;        // 公开的选项叫 imageQuality
  this.options.imageConverter(() => plainImageData, imageType, quality)
```

`PdfRenderOptions` 里根本没有 `quality` 这个字段，于是永远是 `undefined`，浏览器 canvas 编码器退回自己的默认质量。同一个文件里的 `encodeAppearanceMap` 读的是 `options?.imageQuality`，是对的——所以这是漏改一处，不是有意的两套名字。

## 解法

两个名字都传，并 `as PdfRenderPageOptions` 绕过多余属性检查（`quality` 不在类型里）：

```ts
{ imageType: "image/jpeg", imageQuality: 0.8, quality: 0.8 } as PdfRenderPageOptions
```

上游改回 `imageQuality` 之后这么写照样对，两条路都指向同一个值。封面因此从 24795 字节降到 16271。
