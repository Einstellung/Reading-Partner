# WebKit 在首屏前按 family 逐个查字体，查不到的每个约 33ms

## 现象

生产构建在 WebKit 里，React 第一次写进 `#root` 是 140ms，首次内容绘制（FCP）是 219ms —— 提交到出像素之间空了 78ms。同一棵树同一份 DOM，Chromium 是 12ms，Firefox 是 25ms。这 78ms 和 JS 体积无关：把 1.4MB 的 `App` + `useShellBootstrap` 全部拿掉（只留 React 和同一份 DOM 的静态页），提交到绘制仍然是 78ms。

## 原因

`styles.css` 的 `body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif }`。栈里排在前面的 family，WebKit 自己解析不出的，每一个都要走一次查询，每个文档重来一次。同一棵 DOM（99 个元素）只换 `body` 的字体栈，静态页 FCP：

| 字体栈 | FCP |
|---|---|
| `sans-serif` | 42.6ms |
| `-apple-system, sans-serif` | 42.4ms |
| `"Noto Sans", sans-serif`（本机装了） | 48.8ms |
| `system-ui, sans-serif` | 77.3ms |
| `"Segoe UI", sans-serif` | 77.6ms |
| `system-ui, -apple-system, "Segoe UI", sans-serif`（现在这条） | 108.0ms |

`-apple-system` 不要钱，`system-ui` 和 `"Segoe UI"` 各要约 33ms。注意 `fc-match` 对这三个名字都返回 Noto Sans —— fontconfig 解得出，WebKit 仍然付这笔钱。Chromium 和 Firefox 换同一批栈没有差别（Chromium 29ms vs 38ms，Firefox 72ms vs 70ms），所以这条只有在 WebKit 上量才看得见。

## 解法

端到端验证：只把生产构建产物里 `body` 那一条改成 `font-family: sans-serif`，其余不动，WebKit 的 FCP 从 219ms 降到 159ms（6 次，157-162），提交到绘制从 78ms 降到 26ms。

不能直接就这么改：`system-ui` 和 `-apple-system` 是 macOS/iOS 上要的。要改就按平台分，或者让 Linux 上第一个 family 就命中一个装着的字体。

现状：`src/styles.css` 里这一条还是原样，没有按平台分过，这个坑目前还踩着。

## 量的范围

以上在 playwright 的 WebKit 26.5（headless，Linux，`~/.cache/ms-playwright/webkit-2336`）上实测，不是 Tauri 用的系统 WebKitGTK 2.52.3。字体解析正是两者可能不同的地方（GTK 那边 `system-ui` 可能走 GSettings 直接拿到桌面字体）。下次开着 `tauri dev` 的窗口时验一次：在 devtools 里跑
`document.body.style.setProperty("font-family","sans-serif","important")` 之前和之后各 reload 一次，读 `performance.getEntriesByType("paint")`。

## 顺带量到的启动预算

WebKit，生产构建，vite preview，中位数（n=7，跨 run 的散布不超过 ±5ms）：

| 段 | 耗时 | 到 |
|---|---|---|
| 入口 chunk（159kB）取回 + CSS | 8ms | |
| 入口 chunk 解析执行 | 20ms | 28ms |
| `App`（731kB）+ `useShellBootstrap`（683kB）取回 | 17ms | 45ms |
| 两个 boot chunk 解析执行 + React 首次提交 | 95ms | 140ms |
| 样式解析 + 字体 + 布局 + 绘制 | 78ms | 219ms |

三个引擎并排（同一棵树，同一台机器，中位数）：

| | dev FCP | 生产 FCP | 生产 `#root` 首次变动 |
|---|---|---|---|
| WebKit | 378ms | 219ms | 140ms |
| Chromium | 428ms | 88ms | 76ms |
| Firefox | 440ms | 192ms | 166ms |

生产里 WebKit 比 Chromium 慢 131ms，两笔：boot chunk 的解析执行 95ms vs 31ms，提交到绘制 78ms vs 12ms。dev 里 WebKit 反而最快。

拆 boot chunk 能省多少，用同一棵树里现成的两个小 boot path 量出来：只加载入口 chunk 的静态页（React + 同一份 DOM）首次提交 64ms，`?shell=phone`（`App` 不加载，`useShellBootstrap` 照旧）118ms，桌面壳 140ms。所以把 reader/EmbedPDF 那一半（`App`）挪出启动路径值 22ms，把 `useShellBootstrap` 拖进来的 typebox（未压缩 436kB，`ai/aiClient` 列 provider 用）和 pi-ai 挪出去值 54ms，两个都做值 76ms。字体栈那一行值 60ms。

首屏不等任何文件读取：把所有 Tauri fs IPC 延迟 900ms（`__TAURI_INTERNALS__.invoke` 换成延迟后 reject 的桩），第一次 invoke 在 29ms 发出、928ms 才回来，`#root` 照样在 146ms 提交、FCP 224ms（对照组桩延迟 0ms：140ms / 216ms）。dev 同样。
