# 坑清单

踩过一次才知道的意外行为。一坑一文件，格式：现象 / 原因 / 解法。踩到新坑就在这里加一个文件，并把文件名加进下面的索引。

标 historical 的是 zotero/reader 引擎时代的坑（引擎已换成 EmbedPDF，文件留作历史）。

- [02-math-sumprecise-polyfill](./02-math-sumprecise-polyfill.md) — mobile pdf.js 裸调 Math.sumPrecise（historical，zotero 引擎）
- [04-programmatic-select-no-popup](./04-programmatic-select-no-popup.md) — 程序化选中不弹浮窗（historical，zotero 引擎）
- [07-image-annotation-base64](./07-image-annotation-base64.md) — image 标注内联截图导致 JSON 膨胀（historical，zotero 引擎）
- [09-appdata-glob-capability](./09-appdata-glob-capability.md) — Tauri 权限 glob 不匹配目录本身
- [10-cross-realm-uint8array](./10-cross-realm-uint8array.md) — iframe 跨 realm 的 Uint8Array instanceof（historical，zotero 引擎）
- [11-engine-calls-before-init](./11-engine-calls-before-init.md) — 引擎方法必须等 onInitialized 之后调（historical，zotero 引擎）
- [12-webkitgtk-drag-latency](./12-webkitgtk-drag-latency.md) — WebKitGTK 拖选高亮时选区滞后于鼠标（historical，zotero 引擎的 pdf.js DOM 渲染路径）
- [14-dev-build-oomd-session-kill](./14-dev-build-oomd-session-kill.md) — 全量 Rust 编译触发 systemd-oomd 杀整个桌面会话
- [15-plugin-http-forced-origin](./15-plugin-http-forced-origin.md) — Tauri http 插件强制补 Origin,Anthropic 视其为 CORS 请求
- [16-webkitgtk-clipboard-image](./16-webkitgtk-clipboard-image.md) — WebKitGTK 的 DOM paste 事件不带图片,贴图要从 Rust 读剪贴板
- [18-embedpdf-load-hangs-progress-zero](./18-embedpdf-load-hangs-progress-zero.md) — EmbedPDF 文档加载静默卡 progress 0,需跨源隔离头 + 直连引擎(worker:false)
- [19-embedpdf-initialdocuments-hang](./19-embedpdf-initialdocuments-hang.md) — EmbedPDF initialDocuments 卡 loading,改成 init 后显式 openDocumentBuffer
- [20-embedpdf-renderlayer-eats-pointer](./20-embedpdf-renderlayer-eats-pointer.md) — EmbedPDF RenderLayer 的 img 吃指针事件,划词失效,需 pointerEvents:none
- [21-embedpdf-worker-engine-hangs](./21-embedpdf-worker-engine-hangs.md) — EmbedPDF worker 引擎 openDocument 永久挂起(blob worker 里 pthread 辅助 worker 解析不了),暂用直连引擎 + tiling
- [22-embedpdf-scrolltopage-viewport-gap](./22-embedpdf-scrolltopage-viewport-gap.md) — scrollToPage 的 pageCoordinates 多加 viewport gap,页内位置还原要减掉
- [23-embedpdf-current-page-metrics-zero](./23-embedpdf-current-page-metrics-zero.md) — "当前页"的可见区 origin 常是 0,持久化锚点要用最顶上的可见页
- [24-pdfjs-operatorlist-needs-dom](./24-pdfjs-operatorlist-needs-dom.md) — pdf.js getOperatorList/render 要 DOMMatrix,只能在 webview 跑,bun 测试覆盖纯函数
- [25-embedpdf-no-region-raster](./25-embedpdf-no-region-raster.md) — EmbedPDF 适配层没有区域截图,图片裁剪改用自带 pdf.js 渲染
- [26-plugin-http-abort-resource-id-leak](./26-plugin-http-abort-resource-id-leak.md) — Tauri http 插件 abort 后 fire-and-forget 取消,泄漏 "resource id N is invalid" 未捕获拒绝
- [28-http-scope-is-unix-glob](./28-http-scope-is-unix-glob.md) — Tauri http scope 是 UNIX glob 不是 URLPattern,"任意 https 主机"写 `https://*`
- [27-embedpdf-searchinpage-not-on-engine](./27-embedpdf-searchinpage-not-on-engine.md) — searchInPage 在 IPdfiumExecutor 不在 PdfEngine,定点搜索改用 searchAllPages 按页过滤
- [29-voice-stt-fetch-and-ipc-bytes](./29-voice-stt-fetch-and-ipc-bytes.md) — 语音 STT 请求必须走 cleanTauriFetch(CSP+CORS 双杀直连);Rust 返回 Vec<u8> 是 JSON 数字数组
- [30-webview-csp-coep-block-external-img](./30-webview-csp-coep-block-external-img.md) — webview 的 CSP+COEP 双杀外链图片,文章图片要走 http 路由取字节内联成 data: URL
- [31-ios-deep-link-scheme-build-time](./31-ios-deep-link-scheme-build-time.md) — iOS 自定义 scheme 只能构建期静态注册进 tauri.conf,不能靠 env,且要和 env client id 手工对齐
- [32-embedpdf-useviewportref-vs-element](./32-embedpdf-useviewportref-vs-element.md) — useViewportRef 每次新建 ref(挂自渲染元素用),读现有滚动容器要用 useViewportElement
- [33-ios-no-cross-origin-isolation-still-renders](./33-ios-no-cross-origin-isolation-still-renders.md) — iOS WKWebView 自定义协议下没有跨源隔离/SAB,但 PDFium 直连引擎单线程照样渲染;闸门可在模拟器无签名验证
- [34-ios-init-default-icon-alpha](./34-ios-init-default-icon-alpha.md) — tauri ios init 用内置默认图标模板不读我们的图标,CI init 后要覆盖 appiconset;iOS 图标 strip alpha,CFBundleIconName 兜底
- [35-ios-unsigned-linkedit-vmsize](./35-ios-unsigned-linkedit-vmsize.md) — 完全无签名 Mach-O 过第三方重签名器时 __LINKEDIT vmsize 不更新真机秒崩,产线预 ad-hoc 签名规避
- [36-appdata-root-not-created-first-write](./36-appdata-root-not-created-first-write.md) — iOS 首装首跑第一个写入者报 os error 2,数据根目录改由 Rust setup create_dir_all 元能力保障,前端不再各自兜底
- [37-embedpdf-page-touch-action-none-all-modes](./37-embedpdf-page-touch-action-none-all-modes.md) — EmbedPDF 每页 div 所有模式都 touch-action:none,页面上原生触摸滚动不可能;笔手路由必须在 viewport 容器 capture 阶段按 pointerType 逐事件做
- [38-embedpdf-pinch-selection-global-pause](./38-embedpdf-pinch-selection-global-pause.md) — 缩放走原生 touch 通道、选区 handler 不分 pointerId、pause 是全局的;多指/手掌/笔占用期间要逐指针 stopPropagation 而不是 pause
- [39-ios-no-web-palm-rejection](./39-ios-no-web-palm-rejection.md) — iPad 上笔手互斥由系统强制且关不掉,接触面积也拿不到;web 层的掌抑制做不了也不用做,按面积判掌反而会掐死 pinch
- [40-embedpdf-horizontal-strip-no-page-snap](./40-embedpdf-horizontal-strip-no-page-snap.md) — 横向布局是紧挨排布的页带、scrollToPage 左对齐、pageGap 运行期改不了;"一屏一页"要宿主自己算 alignX 居中
- [41-zoom-wrapper-owns-content-transform](./41-zoom-wrapper-owns-content-transform.md) — 内容元素的 transform 归缩放预览所有,橡皮筋只能用 rAF 回弹、不能留 CSS transition
- [42-scroll-strategy-relayout-not-guaranteed](./42-scroll-strategy-relayout-not-guaranteed.md) — 换 scroll strategy 的重排在文档非 loaded 时静默跳过,竖屏下 fit-page 和 fit-width 数值相同也不触发重排;切布局要全量应用+下一帧再断言
- [43-webkit-tap-highlight-orphan-shadow](./43-webkit-tap-highlight-orphan-shadow.md) — 不引 preflight 也就没关掉 WKWebView 的原生点击高亮;点完即卸载的按钮会留下一块孤儿阴影,按下反馈改用 active:
- [44-finger-draw-heuristic-kills-scrolling](./44-finger-draw-heuristic-kills-scrolling.md) — "没见过笔就让手指画"让选了标注工具的手指在 vertical 下彻底滑不动(paged 靠边缘滑还能翻页,像只坏了一半);删掉启发式,改成默认关闭的 fingerDraw 设置项
- [45-vertical-band-cannot-move-scroll-content](./45-vertical-band-cannot-move-scroll-content.md) — 平移滚动内容会改可滚溢出区,浏览器夹紧 scrollTop 正好抵消掉偏移;纵向橡皮筋要平移滚动容器自己,外层包裹 div 负责裁切和补色
- [46-navlock-pen-still-drags-selection](./46-navlock-pen-still-drags-selection.md) — navlock 下笔的 move 仍放行给引擎,滚动正常但照样拖出选区;逐指针拦 move、放行 down/up,保住 tap
- [47-asc-key-role-cloud-signing](./47-asc-key-role-cloud-signing.md) — CI 云签名要 Admin 权限的 App Store Connect API key,App Manager 在 export 阶段被拒;试探权限不能用坏 payload(校验在鉴权前,一律 409)
- [48-tauri-ios-signing-log-noise](./48-tauri-ios-signing-log-noise.md) — tauri ios build 的"找不到证书"警告和 `Apple Distribution: Tauri (unset)` 证书都是 Tauri 自己的噪音,签名成没成看 export 阶段
