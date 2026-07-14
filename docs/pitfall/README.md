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
- [11-engine-calls-before-init](./11-engine-calls-before-init.md) — 引擎方法必须等 onInitialized 之后调
- [12-webkitgtk-drag-latency](./12-webkitgtk-drag-latency.md) — WebKitGTK 拖选高亮时选区滞后于鼠标
- [13-pen-stroke-no-popup-coords](./13-pen-stroke-no-popup-coords.md) — 笔工具划完不给浮窗坐标,气泡锚点靠 pointerup 兜底
- [14-dev-build-oomd-session-kill](./14-dev-build-oomd-session-kill.md) — 全量 Rust 编译触发 systemd-oomd 杀整个桌面会话
- [15-plugin-http-forced-origin](./15-plugin-http-forced-origin.md) — Tauri http 插件强制补 Origin,Anthropic 视其为 CORS 请求
- [16-webkitgtk-clipboard-image](./16-webkitgtk-clipboard-image.md) — WebKitGTK 的 DOM paste 事件不带图片,贴图要从 Rust 读剪贴板
