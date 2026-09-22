# pdf.js 抽全文在 iPhone 模拟器上的实测

2026-09-22。回答一个问题：手机课堂的正文只能在手机上现抽（全文缓存 `sync: "local"`，桌面抽好的到不了手机），那么 `src/fulltext/extract.ts` 的 `extractFulltext` 在 iOS 的 WKWebView 里跑一本大书要多久、会不会卡死。

能用，没有悬念。548 页 73MB 的书冷启动 3.1 秒抽完，15 页的论文 0.2-0.3 秒。整个过程主线程不卡（帧间隔中位 17ms，最坏 47ms），屏幕不白，pdf.js 的 worker 正常起来、没有回退到主线程。手机课堂的正文地基成立，不需要只抽前 N 页，也不需要把 fulltext 放进同步范围。

唯一要盯的是内存：548 页那本让 WebContent 的 phys_footprint 峰值到 609-704MB，和 PDFium 开一本论文的量级一样（[pdfium-on-iphone](./pdfium-on-iphone.md)），模拟器不管，真机 jetsam 管。论文尺寸（15-214 页）峰值 274-368MB，不构成问题。

## 测试环境

iPhone 17 模拟器（udid F7D3DAF8…C80A）、iOS 26.5、Mac mini。视口 402×874 CSS px，devicePixelRatio 3。走 `tauri ios dev` 的真包（手机壳，`location.href` 是 `tauri://localhost`），vite dev server 在 1420。抽取直接调 `extractFulltext`，不经课堂屏——课堂屏还不存在。

三份被测文件，放在 `public/probe/` 由 dev server 发，webview 用 `fetch` 取：

| 名字 | 来源 | 页数 | 字节 |
|---|---|---|---|
| paper15 | arXiv 1706.03762 Attention Is All You Need | 15 | 2.2MB |
| fm214 | arXiv 2108.07258 On the Opportunities and Risks of Foundation Models | 214 | 14.4MB |
| rlbook | Sutton & Barto, Reinforcement Learning 2nd ed.（incompleteideas.net） | 548 | 73.1MB |

页数是 `extractFulltext` 自己报的 `pages.length`。

## 数字

每份文件：`simctl terminate` + `launch` 拿一个干净的 WebContent，装探针，在同一个进程里连抽三次。第一次含 pdf.js 分片加载和 worker 冷启，后两次不含。

| 文件 | 页数 | 第 1 次 (ms) | 第 2 次 | 第 3 次 | ms/页（冷/热） | 抽出字符 | outline 条目 |
|---|---|---|---|---|---|---|---|
| paper15 | 15 | 279 | 208 | 267 | 18.6 / 13.9 | 39,628 | 22 |
| fm214 | 214 | 1712 | 1292 | 1295 | 8.0 / 6.0 | 856,096 | 39 |
| rlbook | 548 | 3895 | 3246 | 3157 | 7.1 / 5.8 | 1,568,768 | 191 |

上面是 `extractFulltext` 本身。加上取字节和加载 pdf.js 分片，冷启一次的端到端（`totalMs`）：paper15 311ms、fm214 1830ms、rlbook 4105ms。另一次干净进程上的 rlbook 冷启是 3085ms，所以 548 页这一档的冷启在 3-4 秒之间浮动。

取字节和加载 pdf.js 都不是瓶颈：dev server 上 73MB 取回来 143-188ms，pdf.js 分片首次加载 18-32ms，之后 0。

三份文件 `status` 全是 `ok`，`pages[0]` 的开头读得通（不是乱码），outline 都解出来了——章表这一步不缺料。

## 主线程和屏幕

抽取期间用 rAF 采样帧间隔：

| 文件 | 采到的帧 | 中位 (ms) | 最坏 (ms) |
|---|---|---|---|
| paper15 | 13-19 | 17 | 17-28 |
| fm214 | 73-109 | 17 | 23-82 |
| rlbook | 198-245 | 17 | 32-47 |

抽 548 页的 3.9 秒里 rAF 一直在跑，中位 17ms 就是 60fps。最坏 47ms 是一次掉两帧，出现在文本页组装那一段。解析在 worker 里，主线程只收结果，`extractFromDocument` 每 8 页 `await setTimeout(0)` 那一条软化措施在这个量级上已经够了。

抽 rlbook 的第 1 秒截图：手机首页正常渲染，不白屏。

## worker

起得来，而且是真 worker。探针在 pdf.js 加载前替换 `window.Worker` 记下每次构造：每调一次 `getDocument` 就有一个 `pdf.worker.min.mjs`，没有 "Setting up fake worker" 那条回退日志，控制台一条 warn/error 都没有。

注意这是 dev 模式：`workerSrc` 是 `http://localhost:1420/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`，页面本身在 `tauri://localhost`，等于一个跨源 worker，它照样起来了。生产包里 `?url` 产出的是 `tauri://localhost/assets/` 下的同源文件，比这个更宽松，但没有实测——这是本文唯一的未验点。

## 内存

`footprint -p <WebContent pid>` 读 `phys_footprint`。每组都先拿干净进程。

| 文件 | 空闲 | 抽 1 次后（当前 / 峰值） | 抽 3 次后（当前 / 峰值） |
|---|---|---|---|
| paper15 | 160MB | 197 / 274 | 190 / 274 |
| fm214 | 167MB | 230 / 331 | 290 / 368 |
| rlbook | 155MB | 308 / 609 | 388 / 623 |
| rlbook（另一次冷启） | 250MB | 384 / 704 | — |

读法：抽一本书的峰值大致是「空闲 + 页数×1MB」这个量级。论文尺寸完全无害。548 页 73MB 那本峰值 609-704MB，和 PDFium 开一本 45 页论文的峰值（700-760MB）同一档，在真 iPhone 上离 jetsam 不远。模拟器不跑 jetsam，这个数字只能当量级参考。

连抽三次当前占用是涨的（rlbook 308→610→388MB，fm214 230→271→290MB），峰值涨得很少，说明抽完能还回去一部分但不干净。课堂一本书只抽一次并落盘，第二次进课堂读缓存，所以这个累积在产品路径上碰不到。

## 对手机课堂的结论

- 按论文（15-50 页）算，第一次进课堂的抽取是 0.2-0.5 秒，状态行大概率一闪而过；真正的等待是下载字节那一步。
- 按大部头（500 页以上）算，3-4 秒，需要一行状态文案，不需要进度条。
- 不需要「只抽前 N 页」的降级，也不需要改同步范围。
- 内存上，500 页以上的 PDF 在真机上有被 jetsam 杀掉的风险，和用 PDFium 开一本论文的风险是同一个量级。真机上没验过。

## 没测

- 生产包（`tauri ios build`）里的 worker 路径。只测了 dev。
- 真机。模拟器的 phys_footprint 混着宿主 macOS 的映射，且不跑 jetsam。
- 中文 PDF 和扫描件。`status: "no-text-layer"` 这条分支没有在 iOS 上走过。
- 抽取中途切后台。iOS 挂起 WebContent 会不会让 `ensureFulltext` 永远不返回，没测。
