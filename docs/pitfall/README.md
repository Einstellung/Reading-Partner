# 坑清单

踩过一次才知道的意外行为。一坑一文件，格式：现象 / 原因 / 解法。踩到新坑就在这里加一个文件，并把文件名加进下面的索引。

- [01-pdf-relative-path](./01-pdf-relative-path.md) — 宿主页必须和 pdf/ 目录同级
- [02-math-sumprecise-polyfill](./02-math-sumprecise-polyfill.md) — mobile pdf.js 裸调 Math.sumPrecise
- [03-initialized-promise](./03-initialized-promise.md) — 顶层 initializedPromise 永不 resolve
- [04-programmatic-select-no-popup](./04-programmatic-select-no-popup.md) — 程序化选中不弹浮窗
- [05-onselect-echo-required](./05-onselect-echo-required.md) — 点击弹窗要求宿主回喂 selectAnnotations
- [06-host-annotation-update-api](./06-host-annotation-update-api.md) — 宿主改/删标注的正确 API
- [07-image-annotation-base64](./07-image-annotation-base64.md) — image 标注内联截图导致 JSON 膨胀
- [08-build-network-dependency](./08-build-network-dependency.md) — reader 构建期要联网下语言文件
- [09-appdata-glob-capability](./09-appdata-glob-capability.md) — Tauri 权限 glob 不匹配目录本身
- [10-cross-realm-uint8array](./10-cross-realm-uint8array.md) — iframe 跨 realm 的 Uint8Array instanceof
