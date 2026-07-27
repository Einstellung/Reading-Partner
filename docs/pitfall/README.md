# 坑清单

踩过一次才知道的意外行为。一坑一文件，格式：现象 / 原因 / 解法。踩到新坑就加一个文件，并加进下面对应的一组。

按主题分组，动哪块扫哪组：

| 你要动的 | 扫这几组 |
|---|---|
| 阅读引擎、页面渲染、滚动定位 | EmbedPDF 引擎 |
| iPad 触摸、笔、缩放、翻页 | 触摸与手势 + EmbedPDF 引擎 |
| 发请求、外链资源、CSP | 网络与 CSP |
| 读写 AppData | 存储与数据目录 |
| 同步引擎、Drive 后端 | 存储与数据目录 + 网络与 CSP |
| 全文/图片提取、裁图 | 提取（壳侧 pdf.js） |
| 出 iOS 包、签名、图标、深链接 | iOS 构建与签名 |
| 桌面 webview 行为异常 | WebKit / webview |
| 调模型、改 provider 层 | AI 调用（pi-ai） |

末尾的「历史」是换引擎前留下的，日常不用扫。

## EmbedPDF 引擎

- [18-embedpdf-load-hangs-progress-zero](./18-embedpdf-load-hangs-progress-zero.md) — 文档加载静默卡 progress 0，需跨源隔离头 + 直连引擎（worker:false）
- [19-embedpdf-initialdocuments-hang](./19-embedpdf-initialdocuments-hang.md) — initialDocuments 卡 loading，改成 init 后显式 openDocumentBuffer
- [20-embedpdf-renderlayer-eats-pointer](./20-embedpdf-renderlayer-eats-pointer.md) — RenderLayer 的 img 吃指针事件，划词失效，需 pointerEvents:none
- [21-embedpdf-worker-engine-hangs](./21-embedpdf-worker-engine-hangs.md) — worker 引擎 openDocument 永久挂起（blob worker 里解析不了 pthread 辅助 worker），走直连引擎 + tiling
- [22-embedpdf-scrolltopage-viewport-gap](./22-embedpdf-scrolltopage-viewport-gap.md) — scrollToPage 的 pageCoordinates 多加 viewport gap，页内位置还原要减掉
- [23-embedpdf-current-page-metrics-zero](./23-embedpdf-current-page-metrics-zero.md) — "当前页"的可见区 origin 常是 0，持久化锚点要用最顶上的可见页
- [27-embedpdf-searchinpage-not-on-engine](./27-embedpdf-searchinpage-not-on-engine.md) — searchInPage 在 IPdfiumExecutor 不在 PdfEngine，定点搜索改用 searchAllPages 按页过滤
- [32-embedpdf-useviewportref-vs-element](./32-embedpdf-useviewportref-vs-element.md) — useViewportRef 每次新建 ref（挂自渲染元素用），读现有滚动容器要用 useViewportElement
- [40-embedpdf-horizontal-strip-no-page-snap](./40-embedpdf-horizontal-strip-no-page-snap.md) — 横向布局是紧挨排布的页带、scrollToPage 左对齐、pageGap 运行期改不了；"一屏一页"要宿主自己算 alignX 居中
- [42-scroll-strategy-relayout-not-guaranteed](./42-scroll-strategy-relayout-not-guaranteed.md) — 换 scroll strategy 的重排在文档非 loaded 时静默跳过，竖屏下 fit-page 和 fit-width 数值相同也不触发重排；切布局要全量应用 + 下一帧再断言
- [50-programmatic-jump-fights-gesture-scroll](./50-programmatic-jump-fights-gesture-scroll.md) — 宿主跳页不停掉惯性就被自己的 fling 覆盖（落点差两千像素），`behavior:"smooth"` 还把 scrollTop 交给浏览器动画；跳转要先 resetGestures 再 instant 落点
- [56-layout-switch-centres-before-geometry](./56-layout-switch-centres-before-geometry.md) — 切布局后居中跑在 DOM 重排前面，落点被浏览器夹掉且无人察觉；重复 setScrollStrategy 是空操作、同尺度 requestZoom 不重排，要按几何判据等 + 复核落点
- [57-zoom-plugin-rewrites-scroll-150ms-after-resize](./57-zoom-plugin-rewrites-scroll-150ms-after-resize.md) — 缩放插件用 150ms debounce 回应视口变化，到期时按缓存里的旧滚动位置再写一次，把旋转后刚居中的页面拉回去；落点确认要盯满整个帧预算
- [58-broken-pdf-open-resolves-instead-of-rejecting](./58-broken-pdf-open-resolves-instead-of-rejecting.md) — 解析失败的文档 openDocumentBuffer 照常 resolve，只有 onDocumentError 和 core 里的 status:"error" 说话；不订阅就是永远的灰屏加 “Rendering…”
- [59-tool-switch-republishes-selection](./59-tool-switch-republishes-selection.md) — onStateChange 是整份状态的流，切工具把还留着的选中同步再播一遍，宿主当成新选中武装 150ms 兜底定时器，标注编辑器在页面中间凭空弹出；按 selectedUids 数组身份判选中是否真的动了
- [60-annotation-plugin-selects-what-it-creates](./60-annotation-plugin-selects-what-it-creates.md) — `selectAfterCreate` 运行期默认为真（类型注释写反成 default false），每画完一笔新标注就是选中的，宿主据此把标注编辑器弹在页面上；注册插件时显式关掉，创建从此不动选中
- [61-viewport-metrics-never-see-their-own-padding](./61-viewport-metrics-never-see-their-own-padding.md) — 视口插件的 ResizeObserver 看 content box，而它自己的 padding 只改 client box，度量停在 padding 之前就再也不更新；fit 永远小 2×gap，一整页填不满屏幕、邻页露一条，重发 requestZoom 修不了。几何判据加"插件度量等于元素度量"和"scale 等于该视口解出的 fit"，打开时的还原也走 settle
- [62-paged-strip-topmost-visible-page-is-the-previous-one](./62-paged-strip-topmost-visible-page-is-the-previous-one.md) — 横排页带两侧邻页常露一条，坑 23 的"最顶上的可见页"在翻页模式下指的是上一页，存的位置每次退一页；锚点按布局分，翻页用插件的 `getCurrentPage()`（居中那页）且不存页内偏移
- [63-first-painted-frame-is-always-page-one](./63-first-painted-frame-is-always-page-one.md) — 放置要等几何，等的那几帧照画，画的是滚动容器的原点即第 1 页，缩窗口去不掉；视口插件的 gate 会把 Scroller 卸掉（等于死锁），要的是滚动容器上的 `visibility:hidden`，落点确认或 settle 停下就放出来

## 触摸与手势

- [37-embedpdf-page-touch-action-none-all-modes](./37-embedpdf-page-touch-action-none-all-modes.md) — 每页 div 所有模式都 touch-action:none，页面上原生触摸滚动不可能；笔手路由必须在 viewport 容器 capture 阶段按 pointerType 逐事件做
- [38-embedpdf-pinch-selection-global-pause](./38-embedpdf-pinch-selection-global-pause.md) — 缩放走原生 touch 通道、选区 handler 不分 pointerId、pause 是全局的；多指/手掌/笔占用期间要逐指针 stopPropagation 而不是 pause。附：`setPointerCapture` 重定向掉引擎的 pointerup，每次滚动都留活 anchor，之后任意一个 move 就把整页选蓝；接管时要补发合成 pointerup
- [39-ios-no-web-palm-rejection](./39-ios-no-web-palm-rejection.md) — iPad 上笔手互斥由系统强制且关不掉，接触面积也拿不到；web 层的掌抑制做不了也不用做，按面积判掌反而会掐死 pinch
- [41-zoom-wrapper-owns-content-transform](./41-zoom-wrapper-owns-content-transform.md) — 内容元素的 transform 归缩放预览所有，橡皮筋只能用 rAF 回弹、不能留 CSS transition
- [44-finger-draw-heuristic-kills-scrolling](./44-finger-draw-heuristic-kills-scrolling.md) — "没见过笔就让手指画"让选了标注工具的手指在 vertical 下彻底滑不动；删掉启发式，改成默认关闭的 fingerDraw 设置项
- [45-vertical-band-cannot-move-scroll-content](./45-vertical-band-cannot-move-scroll-content.md) — 平移滚动内容会改可滚溢出区，浏览器夹紧 scrollTop 正好抵消掉偏移；纵向橡皮筋要平移滚动容器自己
- [46-navlock-pen-still-drags-selection](./46-navlock-pen-still-drags-selection.md) — navlock 下笔的 move 仍放行给引擎，滚动正常但照样拖出选区；逐指针拦 move、放行 down/up，保住 tap
- [49-webkit-native-selection-over-page](./49-webkit-native-selection-over-page.md) — 阅读区没 DOM 文本也照样能起原生选区（WebKit 只看 `user-select` 用值），整页变蓝加系统 callout；阅读区根节点关掉 user-select 和 touch-callout，引擎选区不受影响。与坑 43 同族

## 网络与 CSP

- [15-plugin-http-forced-origin](./15-plugin-http-forced-origin.md) — Tauri http 插件强制补 Origin，Anthropic 视其为 CORS 请求
- [26-plugin-http-abort-resource-id-leak](./26-plugin-http-abort-resource-id-leak.md) — http 插件 abort 后 fire-and-forget 取消，泄漏 "resource id N is invalid" 未捕获拒绝
- [28-http-scope-is-unix-glob](./28-http-scope-is-unix-glob.md) — Tauri http scope 是 UNIX glob 不是 URLPattern，"任意 https 主机"写 `https://*`
- [29-voice-stt-fetch-and-ipc-bytes](./29-voice-stt-fetch-and-ipc-bytes.md) — 跨源请求必须走 cleanTauriFetch（CSP + CORS 双杀直连）；Rust 返回 Vec<u8> 到 JS 是数字数组
- [30-webview-csp-coep-block-external-img](./30-webview-csp-coep-block-external-img.md) — webview 的 CSP + COEP 双杀外链图片，文章图片要走 http 路由取字节内联成 data: URL
- [54-plugin-http-body-json-per-byte](./54-plugin-http-body-json-per-byte.md) — 交给 http 插件的 body 被逐字节 JSON 化（实测 3.54 字符/字节，一次请求 ~20 倍自身大小），26 MB 的书上传峰值 400 MB 触发 iPad jetsam；大 blob 必须分块 PUT

## 存储与数据目录

- [09-appdata-glob-capability](./09-appdata-glob-capability.md) — Tauri 权限 glob 不匹配目录本身；且持久化失败绝不静默吞
- [36-appdata-root-not-created-first-write](./36-appdata-root-not-created-first-write.md) — iOS 首装首跑第一个写入者报 os error 2，数据根目录由 Rust setup 的 create_dir_all 保障，前端不再各自兜底
- [51-sync-stopped-looks-healthy](./51-sync-stopped-looks-healthy.md) — 凭据文件不在，引擎从不启动，`autoSync:true` + `lastError:null` 读起来完全健康，四天没人发现；启动的三选一和「该说什么」都收进 `platform/sync/health.ts`
- [52-all-or-nothing-pass-never-completes](./52-all-or-nothing-pass-never-completes.md) — 一趟同步一个文件失败就整趟中止，丢包链路上 51 个请求的一趟几乎不可能跑完，`Last sync: Never`；改逐项 + 缓存 id 遇 404 自愈 + 重试超时
- [53-identical-rewrite-wins-whole-file](./53-identical-rewrite-wins-whole-file.md) — app 用相同内容重写文件，按 mtime 判就是本地有改动，整文件 LWW 让"只是重存了一次"的设备静默覆盖掉另一台的批注；改内容 hash 判变更 + 三方合并

## 提取（壳侧 pdf.js）

- [24-pdfjs-operatorlist-needs-dom](./24-pdfjs-operatorlist-needs-dom.md) — getOperatorList/render 要 DOMMatrix，只能在 webview 跑，bun 测试只覆盖纯函数；另附矢量图 bbox 的算子解析细节
- [25-embedpdf-no-region-raster](./25-embedpdf-no-region-raster.md) — EmbedPDF 适配层没有区域截图，图片裁剪改用自带 pdf.js 渲染

## iOS 构建与签名

- [31-ios-deep-link-scheme-build-time](./31-ios-deep-link-scheme-build-time.md) — 自定义 scheme 只能构建期静态注册进 tauri.conf，不能靠 env，且要和 env client id 手工对齐
- [33-ios-no-cross-origin-isolation-still-renders](./33-ios-no-cross-origin-isolation-still-renders.md) — iOS WKWebView 自定义协议下没有跨源隔离/SAB，但 PDFium 直连引擎单线程照样渲染；闸门可在模拟器无签名验证
- [34-ios-init-default-icon-alpha](./34-ios-init-default-icon-alpha.md) — tauri ios init 用内置默认图标模板，CI init 后要覆盖 appiconset；iOS 图标 strip alpha，CFBundleIconName 兜底
- [35-ios-unsigned-linkedit-vmsize](./35-ios-unsigned-linkedit-vmsize.md) — 完全无签名 Mach-O 过第三方重签名器时 __LINKEDIT vmsize 不更新，真机秒崩；产线预 ad-hoc 签名规避
- [47-asc-key-role-cloud-signing](./47-asc-key-role-cloud-signing.md) — CI 云签名要 Admin 权限的 App Store Connect API key，App Manager 在 export 阶段被拒；试探权限不能用坏 payload
- [48-tauri-ios-signing-log-noise](./48-tauri-ios-signing-log-noise.md) — "找不到证书"警告和 `Apple Distribution: Tauri (unset)` 证书都是 Tauri 自己的噪音，签名成没成看 export 阶段

## WebKit / webview

- [12-webkitgtk-drag-latency](./12-webkitgtk-drag-latency.md) — WebKitGTK 拖选高亮时选区滞后于鼠标（根因未定，换引擎后没复测）
- [16-webkitgtk-clipboard-image](./16-webkitgtk-clipboard-image.md) — DOM paste 事件不带图片，贴图要从 Rust 读剪贴板
- [43-webkit-tap-highlight-orphan-shadow](./43-webkit-tap-highlight-orphan-shadow.md) — 不引 preflight 也就没关掉 WKWebView 的原生点击高亮；点完即卸载的按钮会留下孤儿阴影，按下反馈改用 active:（同族还有坑 49 的原生选区，收在「触摸与手势」）

## AI 调用（pi-ai）

- [64-replayed-assistant-timestamp-without-usage](./64-replayed-assistant-timestamp-without-usage.md) — 重放的 assistant 消息缺 `timestamp` 和 `usage` 正好绕开 pi 的估算路径；单补 `timestamp` 会让 `clampMaxTokensToContext` 在每一次 AI 调用里抛 TypeError，全 app 的 AI 当场全死

## 开发环境

- [14-dev-build-oomd-session-kill](./14-dev-build-oomd-session-kill.md) — 全量 Rust 编译触发 systemd-oomd 杀整个桌面会话；日常用 `bun run dev:capped`
- [55-worktree-dev-server-serves-stale-modules](./55-worktree-dev-server-serves-stale-modules.md) — worktree 在 `.claude/` 下，正好被 Vite 的 watch ignore 命中，dev server 看不见自己的改动；每次改完要重启

## 历史（zotero/reader 引擎时代）

引擎已换成 EmbedPDF，这几篇留着是因为还有东西没随引擎一起死。每篇开头一行写明哪部分还成立。

- [02-math-sumprecise-polyfill](./02-math-sumprecise-polyfill.md) — mobile pdf.js 裸调 Math.sumPrecise；WebKitGTK 落后于新内建这条仍在，现在体现为加载 pdf.js 前要补 `Promise.withResolvers`
- [04-programmatic-select-no-popup](./04-programmatic-select-no-popup.md) — 程序化选中不弹浮窗；EmbedPDF 下结论反过来了，弹窗照开
- [07-image-annotation-base64](./07-image-annotation-base64.md) — image 标注内联截图导致 JSON 膨胀；区域框选已移除，但"大字段拆出 JSON 单独落盘"被 threads 沿用
- [10-cross-realm-uint8array](./10-cross-realm-uint8array.md) — iframe 跨 realm 的 Uint8Array instanceof；app 里已无 iframe，webview-pipe 会再撞上
- [11-engine-calls-before-init](./11-engine-calls-before-init.md) — 引擎方法必须等就绪信号之后调；PDFViewerApplication 没了，规矩还在
