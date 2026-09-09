# WebKitGTK 的 createImageBitmap 对任何 SVG 都直接抛，画 SVG 只能走 `<img>`

现象：EPUB 的图是书里的文件，SVG 那种要先画成位图才能交给视觉模型（docs/39 §3）。`ai/image-utils.ts` 的解码是"先 `createImageBitmap`，失败再退 `<img>` + object URL"，`createImageBitmap` 这一条对 SVG blob 一次都没成功过。

原因：实测（xvfb 里的 WebKitGTK 2.4，`serve/probe2.js`），四种写法的 SVG blob——只有 `viewBox`、`width="100%"` 加 `viewBox`、什么都没有、显式 `width`/`height`——`createImageBitmap` 全部抛 `InvalidStateError: Cannot decode the data in the argument to createImageBitmap`。不是尺寸问题，是这个引擎的 `createImageBitmap` 不解 SVG。`<img>` 四种全部成功。

同一次量到的 `<img>` 自然尺寸：只有 `viewBox` 报 400x200（按 box 走），`width="100%"` 加 `viewBox` 也报 400x200，两者都不是"报 0"；三样都没有才报 CSS 默认的 300x150。写死 `width`/`height` 之后报的就是写死的值。

解法：解码保持两步，别把 `createImageBitmap` 那条当主路——SVG 永远走 `<img>` 那条，那条本来就是 WebKitGTK 的粘贴图路径需要的。尺寸自己从 SVG 文本算（`figures/raster.ts` 的 `svgIntrinsicSize`：`width`/`height` → `viewBox` → 默认方块），画之前把算出来的尺寸写回根 `<svg>`（`withExplicitSize`），这样"三样都没有"的图不会被 300x150 的框拉变形。`drawImage(img, 0, 0, w, h)` 按给的尺寸画，画出来的像素和不写尺寸时一致（同一次量：painted 都是 2910）。
