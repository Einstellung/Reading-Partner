# EPUB 渲染 spike

把 docs/39 第七节里"只有真机才能验的"逐条量了一遍，并把 foliate-js vendor 进仓库跑通。产出是结论，不是功能。

测的地方：iPad Pro 11-inch (M5) 模拟器 / iOS 26.5 的 WKWebView，页面在 `tauri://localhost` 下；以及 Ubuntu 上 xvfb 里的 WebKitGTK（Version/60.5），页面在 `http://localhost:1430`。工具是 `epub-spike.html` + `src/reading/epub/spike-harness.tsx`，通过 `scripts/ios-sim.sh eval` 驱动。两本书有版权，没进仓库，由一个带 CORS 和 CORP 头的小 HTTP server 从仓库外喂给 harness。

`tauri ios dev` 在模拟器里也走自定义协议：`location.origin` 是 `tauri://localhost`，不是 `devUrl` 的 `http://localhost:1420`。所以下面每条 iOS 的数都是生产协议下的数，不用等打包再验一遍。Linux 的 dev 走的是 http 源，那一侧的协议差异没覆盖到。

## 一、blob: iframe

能用，而且是同源的。

在 `tauri://localhost` 下 `URL.createObjectURL(new Blob([xhtml], {type:"application/xhtml+xml"}))` 建 iframe，`sandbox="allow-same-origin"`（不给 `allow-scripts`）：

| | iOS WKWebView | WebKitGTK |
|---|---|---|
| frame 加载 | 成功，203ms 首次 / 16-20ms 之后 | 成功，6-8ms |
| `contentDocument` | 可读，`origin` 是 `tauri://localhost` | 可读 |
| `contentType` | `application/xhtml+xml` 保住了 | 同 |
| 书里的 `<script>` | 不执行 | 不执行 |
| 内联 `on*` | 不执行 | 不执行 |
| blob 图 / CSS / 字体 | 全部加载 | 全部加载 |

COEP `require-corp` 不拦任何一条：blob 是同源 local scheme，CORP 不适用。iOS 下 `crossOriginIsolated` 仍是 `false`（与坑 33 一致），Linux 下是 `true`；两边行为没差别。

Tauri 的 `on_navigation` 也不拦：`navigation.rs` 已经显式放行 `blob:` 并带单测，实测两个后端都放行。

CSP 的结论和 docs/39 的预判相反，见坑 245：`frame-src 'self'` 在 WebKit 上拦不住 blob frame，真正被拦的是 frame 里的 blob CSS 和字体（`style-src`、`font-src` 里没有 `blob:`）。图能出，因为 `img-src` 已经有 `blob:`。违规事件派发在子文档上，父页收不到，所以只能看效果判断。

量这条时踩了坑 246：iframe 插进 DOM 会先为 about:blank 发一次 `load`，第一版探针因此把一次没发生的导航报成了成功。

## 二、不给 allow-scripts 的代价

代价是 iframe 里一个 DOM 事件都不派发，两个后端一致。见坑 244（WebKit bug 218086，foliate-js 上游就是因为它才写 `allow-scripts` 的）。

DOM 读写、`Range`、CFI 计算、`getComputedStyle` 全部正常。不正常的只有事件：父页在 `contentDocument` 上装的监听器收不到任何东西，连父页自己 `dispatchEvent` 派进去的合成事件都收不到。

系统那一层不受影响。模拟器里对正文长按 1.2 秒，iOS 的选区手柄和 `Copy | Look Up | Translate | Search Web | Share…` callout 照常弹出（有截图），选区落在 frame 的 document 上，父页 `contentDocument.getSelection()` 读得到内容。坑 49 在阅读区根节点关 `user-select` 的那套在这里要重新做一遍——frame 里 `userSelect` 实测是 `text`。

## 三、foliate-js vendor 进来

`vendor/foliate-js/`，上游 commit `78914aef`（2026-05-01），MIT LICENSE 原样带上，来源和拷贝日期写在 `vendor/foliate-js/README.md`。vite 里配了 `foliate-js` 别名指向它。`tests/layering.test.ts` 只扫 `src/`，`vendor/` 不用登记，实测九个用例全绿；新目录 `reading/epub` 已登记进 LAYER 表。

用得上的九个文件：`view.js`、`paginator.js`、`epub.js`、`epubcfi.js`、`overlayer.js`、`search.js`、`progress.js`、`text-walker.js`、`fixed-layout.js`。

另外七个（`mobi.js`、`fb2.js`、`comic-book.js`、`pdf.js`、`tts.js`、`vendor/zip.js`、`vendor/fflate.js`）是抛异常的桩：`view.js` 从 `makeBook()` 和 `initTTS()` 里动态 import 它们，那些分支我们永远不走，但 vite 在 transform 阶段就要解析字面量的动态 import，缺文件整个模块报错。见坑 243。存桩而不删分支，`view.js` 才能和上游逐字节相同。

上游只改了一处：`paginator.js` 的正文 iframe 从 `allow-same-origin allow-scripts` 改成 `allow-same-origin`（可用 `globalThis.__foliateSandbox` 覆盖，供 A/B）。改动带 `PATCHED:` 注释，README 里列着。

book 对象按 docs/39 说的自己实现：zip 用 fflate 的 `unzipSync`，喂 `new EPUB({loadText, loadBlob, getSize, sha1}).init()`。`view.open(book)` 之后必须再 `view.init({})`，否则 renderer 拿到书但不排版，`relocate` 永不触发，看起来像挂死。

消毒的挂点是 `EPUB` 实例的 `transformTarget`：每个资源变成 blob URL 之前发一个 `data` 事件，可以换掉 `detail.data` 和 `detail.type`。消毒这条线不归本 spike。

## 四、分页耗时与内存

`具身智能_从大模型到世界模型_中英对照.epub`（2.3 MB，19 个条目，整本书一个 158 KB 的 spine 文件）：

| | ms |
|---|---|
| fetch | 16 |
| unzip | 44 |
| 解析 OPF 建 book | 3 |
| open + 首屏可读（`relocate`） | 83 |
| 总计 | 251 |
| 翻页 | 中位数 103（跨进大章那一次 850） |

`Fundamentals of Active Inference…zh-bilingual.epub`（71 MB，2255 个条目，70 个 spine 项，最大单章 307 KB）：

| | ms |
|---|---|
| fetch | 52 |
| unzip | 1241 |
| 解析 OPF 建 book | 9 |
| open + 首屏可读 | 13 |
| 总计 | 1420 |
| 开头翻页 | 中位数 150 |
| 跳到 50%（换到 137 K 字符、214 张图的一章） | 475 |
| 在那一章里翻页 | 中位数 104 |
| 跳到 97% | 16 |

首屏不受书大小影响：foliate 一次只排一个 spine 项，13ms 就有东西可读。花钱的是 `unzipSync` 一次把 71 MB 解开。

内存看 WebContent 进程的 RSS（iOS 上 `performance.memory` 不存在，数只能从进程外取）：打开 71 MB 那本前 621 MB，打开后 775 MB，读到中段峰值 775 MB，回落到 691 MB。一本书 +154 MB，而 PDFium 的堆已经占着一份。docs/08 记的页面进程内存上限在这里是真实约束。

翻到书的最后一页之后 `next()` 不再发 `relocate`，等它的代码会一直等——探针里要有超时。

## 五、Web Crypto SHA-1 与 Intl.Segmenter

都可用，两个后端一致。`tauri://localhost` 是 secure context（`isSecureContext: true`），`crypto.subtle.digest("SHA-1", …)` 算 `"abc"` 得 `a9993e364706816aba3e25717850c26c9cd0d89d`，正确。`Intl.Segmenter` 存在，`具身智能的世界模型` 按 word 粒度切成 6 段。字体解混淆和搜索分词都没有障碍。

## 六、CJK 字体回退

模拟器上没有豆腐块。中英对照正文两种模式下都正常：中文一套 CJK 字体、拉丁一套衬线，混排行距正常，行内公式、矩阵和图注都对。foliate 默认字体栈在没有书内 CSS 时是 `Georgia, serif`；带自己 CSS 的书（Active Inference 那本）算出来是 `-webkit-standard`。

`flow` 属性在运行时从 `paginated` 改成 `scrolled`，正文会重排成滚动流，但不重算宽度：正文只占屏幕左边约 55%，右边空着。切模式要连着重设布局，或者重新 `open`。

字号、行距、边距还没调过，现在是 foliate 的默认值。

## 七、阶段 3 的接法

CSP 改三项，不是一项。`tauri.conf.json` 的 `csp` 里：

- `style-src 'self' 'unsafe-inline' blob:`
- `font-src 'self' data: blob:`
- `frame-src 'self' blob:`

前两项是 WebKit 上真正需要的；`frame-src` 在 WebKit 上不加也能跑，加是为了 Chromium/WebView2 那边成立，以及让策略读起来和意图一致。`img-src` 已经有 `blob:`，不动。

资源走 blob，不走 `img:` 自定义协议。 理由是 foliate 的 `Loader` 本来就把每个条目变成 blob URL 并自己引用计数、换章时 revoke；改成自定义协议要重写这一层，还要把整本书的字节留在 Rust 侧。`img:` 协议留给它现在的差事（外链文章图，坑 30）。

foliate 的文件：用九个，桩七个，清单在 `vendor/foliate-js/README.md`。`search.js` 现在没接上，但先留着——它是 `[p.N]` 跳转按引文定位那条路（`jumpToQuote`）在 EPUB 侧的对应件。

事件全在父页做。 坑 244 是这次最硬的约束：正文 iframe 里收不到事件，所以点击翻页、笔手路由、`overlayer.hitTest` 都要在包着 iframe 的容器上监听，按坐标换算进 frame。`touch-routing.ts` 那些纯函数照搬，接线重写。选区靠父页手势加轮询 `contentDocument.getSelection()`，不能等 frame 里的 `selectionchange`。

摄入和渲染共用一次解包。 `unzipSync` 一本 71 MB 的书要 1.2 秒、150 MB 内存，不能在摄入时解一次、渲染时再解一次。解包结果的持有者和生命周期要在阶段 2/3 交界处定死。

还没量的：真机（模拟器的内存上限和 jetsam 行为与真机不同）；笔手路由在 iframe 上的接管参数（坑 117 那套要在新的容器结构上重量）；固定版式（`fixed-layout.js` 一次没跑过）；书内 CSS 与 app 主题的冲突。

## 模拟器验证（2026-09-09，阶段 3）

iPad Pro 11-inch (M5) / iOS 26.5，`tauri ios dev`，竖屏，阅读区 834×1114 CSS px。三本书从 app 容器里按正式路径进：`addFileToTopic` 收下路径，再在 Materials 里点卡片，走 `resolveBookSource` → `importBook` → `openInReader`。系统文件选择器那一步没驱动（模拟器里点不了），它下游全走过了。截图在 `scratchpad/epub-ios/shots/`，书有版权，没进仓库。

### 逐项

| 项 | 结论 |
|---|---|
| 正式打开路径 | 通。《具身智能》59 块、《Active Inference》1088 块，首屏都直接可读 |
| CJK 混排 | 无豆腐。中英同段、连字符断词、行内公式都正常 |
| 书里的图 | 出得来。`blob:tauri://localhost/…`，`naturalWidth` 918 / 2137 / 1905，按 720px 正文宽缩排 |
| frame | `tauri://localhost` 同源、`application/xhtml+xml`、`sandbox="allow-same-origin"`、0 个 `<script>`、0 个 `<link>`、head 里 2 个注入的 `<style>` |
| CSP 三项 | `img-src blob:` 生效（图出得来）。`style-src`/`font-src` 的 `blob:` 这条路根本没用上：书自己的 CSS 被消毒器整块丢掉，也不加载任何 web 字体，`document.fonts.size` 是 0。排版全来自注入的 `<style>`，走的是 `'unsafe-inline'` |
| 正文宽度 | 修前滚动 456px、翻页 674px；修后两个模式都 720px（坑 247） |
| 字号 | Zoom in 一次 19px → 21px |
| 翻页/滚动模式切换 | 菜单里 Paged flip 开关生效，切过去正文重排，宽度不变 |
| 关书重开 | 位置留住。回首页显示「p. 1 of 59」，Materials 里显示「Read 5%」 |
| 点击区翻页、滑动翻页、书内链接 | 全部无效。落在正文 iframe 上的触摸，父页一个事件都收不到（坑 252） |
| 长按正文 | 系统选区手柄和 callout 正常弹，父页 `contentDocument.getSelection()` 读得到（实测 9 个字符）。阶段 4 的事，没动 |
| iOS 文档类型 | `CFBundleDocumentTypes` 已在构建产物 `.app/Info.plist` 里（EPUB + PDF，Viewer / Alternate）。但 app 里没有任何东西消费进来的 file URL，见下 |

### 71 MB 那本

`Fundamentals of Active Inference`（71 MB，1088 个位置块），点卡片到首屏可读 709 ms（含一次 bridge 往返，是上界）。

WebContent 进程 RSS：打开前 524 MB，打开后 1019 MB。一本书 +495 MB，是 docs/62 第四节只量渲染那半时（+154 MB）的三倍多——摄入解包、消毒后的整棵树、分页表和渲染各持有一份。docs/08 记的页面进程内存上限在这里是硬约束，71 MB 已经在能开的上限附近。

### 三件没解决的

事件层在真机上从来没通过。坑 252。翻页点击区、滑动翻页、这次加的书内链接命中测试，全都挂在父页的 pointer 事件上，而落在 iframe 上的触摸父页收不到。frame 上 `pointer-events: none` 能修（实测立刻从 2/59 翻到 3/59），代价是 iOS 长按选区同时归零（实测选中字符数 9 → 0）。两个都要就得做一层可开关的盖板，这次没动，留给标注那一阶段。（后续：标注那边取了 `pointer-events: none`，系统选区不要，选区改在父页用 `caretRangeFromPoint` 自己做。）

分享进来的书没人接。`CFBundleDocumentTypes` 让「文件」和分享面板愿意把 EPUB 交给这个 app，但全仓库只有 OAuth 那条路在听 `onOpenUrl`（`platform/sync/auth.ts`，而且只在登录挂起时才注册）。一个 EPUB 送到 Inbox 之后不会发生任何事。要接得先定：进哪个 topic、没有 topic 时怎么办、进来之后是直接打开还是只入库。

Materials 页的按钮还写着「+ Add PDF」，文件选择器早就收 epub 了。

### Android

仓库里没有 Android 的 intent-filter，PDF 也没有——`src-tauri/gen/android/` 不在版本控制里，`tauri.conf.json` 里也没写。EPUB 这条等 Android 真要做的时候和 PDF 一起加。

## 模拟器验证（第二轮：触摸与标注）

2026-09-09，iPad Pro 11-inch (M5)、iOS 26.5，`tauri ios dev`，触摸走 idb 的 HID 通道。验的是 frame 透明（坑 252 的解法）和阶段 4 的标注在真触摸下成不成立。

| 项 | 结论 |
|---|---|
| 点击区翻页 | 通。右区一次一页（`scrollLeft` +720），左区回一页 |
| 滑动翻页 | 修前一次翻三页，修后一次一页（坑 260） |
| 滚动模式手指滚动 | 通。600px 拖动滚 1076px，惯性再走 54px。`pointerdown` → 6 个 `pointermove` → `pointercancel`，没有 `pointerup`：滚动归 WebKit，pane 收 cancel 收场 |
| vertical / paged 切换 | 通。菜单里的 Paged flip 开关，位置留住 |
| 高亮：横拖 | 通。落标注、overlayer 画一个 `g`、盘上 JSON 和 Linux 那轮逐字段一致（range CFI 带两个逗号、`pageLabel`、`quote` 三件套） |
| 高亮：斜拖/竖拖 | 修前六个 move 之后被滚动抢走，标注落不下（坑 261）。修后 81 个 move 一路到 `pointerup`，`scrollTop` 不动，标注落下 |
| 翻页模式下拖选区 | 修前落标注的同时页面往回翻一页，修后只落标注（坑 260） |
| 点已有标注 | 弹编辑器（七个色块 + Delete）。改色后盘上 `color` 变 `#2ea8e5`，overlayer 仍是一个 |
| 笔在手上时点标注 | 不弹。笔在手上，`pointerAction` 是 draw，落点走 `beginDraw`/`endDraw`，够不到 `consumeUp`。要点标注先收笔——和 PDF 那侧一样 |
| 痕迹列表页码 | 对。盘上 `pageLabel` 7 的那条显示 Page 7，6 的显示 Page 6 |
| 长按正文 | 修前 iOS 照弹 Copy / Translate / Share，选区是父页上的一个换行（坑 262）。修后菜单不弹、选区为空 |
| 关书重开 | 标注还在。HMR 整页重载后回首页，点 Continue reading 重开，overlayer 照画 |

改动：`vendor/foliate-js/paginator.js` 不再注册它自己的三个 touch 监听器（`PATCHED:`），pane 上挂 `{passive:false}` 的 `touchmove` 按 `claimsTouch()` 抢触摸，阅读区补 `data-reader-surface`。

### 还没验的

点痕迹跳转的落点不对：点一行痕迹，顶栏从 6 走到 5，但两条标注的 overlay 都在 x≈1640，也就是屏幕右边两页开外。是点中了别的行还是 `navigate` 走的是块号而不是标注 ID，要再跑一次才知道。

大纲跳转、`[p.N]` 链接、`highlightQuote` 三条经过壳的路，这轮又没点到（第一轮也没有）。书内链接（脚注、章节间）没在有 `<a>` 的书上点过，《The Experience Machine》的 page-list 页码模拟器上仍没看过，71 MB 那本加了标注层之后的内存和翻页耗时没重量。

冷启动后第一次开书卡住过一次：宿主 div 空着、界面停在 Rendering…，18 秒没有 `foliate-view`；退回去再开就正常，之后再没复现。只有一次，没有第二个样本。
