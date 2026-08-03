# 坑清单

踩过一次才知道的意外行为。一坑一文件，格式：现象 / 原因 / 解法。踩到新坑就加一个文件，并加进下面对应的一组。

按主题分组，动哪块扫哪组：

| 你要动的 | 扫这几组 |
|---|---|
| 阅读引擎、页面渲染、滚动定位 | EmbedPDF 引擎 |
| iPad 触摸、笔、缩放、翻页 | 触摸与手势 + EmbedPDF 引擎 |
| 手机上的手势、页面导航 | 触摸与手势 |
| 发请求、外链资源、CSP | 网络与 CSP |
| 读写 AppData | 存储与数据目录 |
| 同步引擎、Drive 后端 | 存储与数据目录 + 网络与 CSP + WebKit / webview |
| 全文/图片提取、裁图 | 提取（壳侧 pdf.js） |
| 出 iOS 包、签名、图标、深链接 | iOS 构建与签名 |
| 桌面 webview 行为异常 | WebKit / webview |
| 渲染链接、点外链、开系统浏览器 | WebKit / webview |
| 确认框、删除之类的破坏性操作 | WebKit / webview |
| 调模型、改 provider 层、组装提示词、加长上下文 | AI 调用与上下文窗口 |
| 顶栏、工具条、下拉浮层的定位 | 界面与布局 |
| 全局样式、Tailwind layer、字体与行高 | 界面与布局 + EmbedPDF 引擎 |

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
- [95-the-viewport-gap-is-charged-twice](./95-the-viewport-gap-is-charged-twice.md) — `viewportGap` 同时是页面四周的 padding、每个 fit 的减数（`clientWidth - 2*gap`）和每个 `scrollToPage` 的加数，改留白就是改整套几何；传 0 能生效只因为 reducer 初值也是 0（`if (config.viewportGap)` 根本不 dispatch）
- [96-the-page-gap-is-not-a-css-length](./96-the-page-gap-is-not-a-css-length.md) — 页间距是未缩放页单位，DOM 的 `gap` 和 virtual items 的步长是同一个数，用 CSS 压掉就让模型和屏幕对不上；只能调注册期的 `defaultPageGap`，且不能为 0（翻页模式靠它把邻页挡在屏外）
- [97-the-spike-harness-measured-a-different-box-model](./97-the-spike-harness-measured-a-different-box-model.md) — harness 不 import `styles.css`，没有 preflight 的 `border-box`，滚动容器比窗口宽 2×gap；引擎调试入口要和 app 用同一份全局基线才量得准

## 触摸与手势

- [37-embedpdf-page-touch-action-none-all-modes](./37-embedpdf-page-touch-action-none-all-modes.md) — 每页 div 所有模式都 touch-action:none，页面上原生触摸滚动不可能；笔手路由必须在 viewport 容器 capture 阶段按 pointerType 逐事件做
- [38-embedpdf-pinch-selection-global-pause](./38-embedpdf-pinch-selection-global-pause.md) — 缩放走原生 touch 通道、选区 handler 不分 pointerId、pause 是全局的；多指/手掌/笔占用期间要逐指针 stopPropagation 而不是 pause。附：`setPointerCapture` 重定向掉引擎的 pointerup，每次滚动都留活 anchor，之后任意一个 move 就把整页选蓝；接管时要补发合成 pointerup
- [39-ios-no-web-palm-rejection](./39-ios-no-web-palm-rejection.md) — iPad 上笔手互斥由系统强制且关不掉，接触面积也拿不到；web 层的掌抑制做不了也不用做，按面积判掌反而会掐死 pinch
- [41-zoom-wrapper-owns-content-transform](./41-zoom-wrapper-owns-content-transform.md) — 内容元素的 transform 归缩放预览所有，橡皮筋只能用 rAF 回弹、不能留 CSS transition
- [44-finger-draw-heuristic-kills-scrolling](./44-finger-draw-heuristic-kills-scrolling.md) — "没见过笔就让手指画"让选了标注工具的手指在 vertical 下彻底滑不动；删掉启发式，改成默认关闭的 fingerDraw 设置项
- [45-vertical-band-cannot-move-scroll-content](./45-vertical-band-cannot-move-scroll-content.md) — 平移滚动内容会改可滚溢出区，浏览器夹紧 scrollTop 正好抵消掉偏移；纵向橡皮筋要平移滚动容器自己
- [46-navlock-pen-still-drags-selection](./46-navlock-pen-still-drags-selection.md) — navlock 下笔的 move 仍放行给引擎，滚动正常但照样拖出选区；逐指针拦 move、放行 down/up，保住 tap
- [49-webkit-native-selection-over-page](./49-webkit-native-selection-over-page.md) — 阅读区没 DOM 文本也照样能起原生选区（WebKit 只看 `user-select` 用值），整页变蓝加系统 callout；阅读区根节点关掉 user-select 和 touch-callout，引擎选区不受影响。preflight 不含 user-select，这条手写规则引入 preflight 之后仍然必需（与坑 43 同族、结局相反）
- [70-browser-claims-the-swipe-before-the-pointer-does](./70-browser-claims-the-swipe-before-the-pointer-does.md) — 只用 pointer 事件写的左缘右滑必被 `pointercancel` 掐死（浏览器判滚动不看方向可行性），`touch-action` 的交集只算到滚动容器为止、挂外层无效；要在非 passive 的 `touchmove` 上 3px 就抢并全程 prevent，另加 `overscroll-behavior-x: none` 挡掉浏览器自己的历史手势
- [71-first-touchmove-is-already-past-the-slop](./71-first-touchmove-is-already-past-the-slop.md) — 抢触摸的阈值在 1–16px 之间毫无区别：浏览器越过自己的 slop 才派发第一个 `touchmove`，那一下的位移已经是 16（手指更快就更大）；这个数只需小到任何第一个 move 都能满足，不是调参
- [83-radix-menu-opens-on-pointerdown-and-the-lift-picks-a-row](./83-radix-menu-opens-on-pointerdown-and-the-lift-picks-a-row.md) — Radix 的菜单 trigger 在 pointerdown 上开，`MenuItem` 又会在没见过 pointerdown 的 pointerup 上自己 click，同一次点按能既开菜单又选中手指下方那一行；trigger 改成在 click 上开，并记住按下时的开合状态（关闭走的是 document 上的 dismiss，排在 React 之后）
- [92-radix-select-already-opens-on-click-for-a-finger](./92-radix-select-already-opens-on-click-for-a-finger.md) — `SelectTrigger` 按指针类型分路（鼠标 pointerdown、手指和笔 click），坑 83 那套绕法照抄过去会双开；实测一按抬手时列表还不在 DOM 里

## 网络与 CSP

- [15-plugin-http-forced-origin](./15-plugin-http-forced-origin.md) — Tauri http 插件强制补 Origin，Anthropic 视其为 CORS 请求
- [26-plugin-http-abort-resource-id-leak](./26-plugin-http-abort-resource-id-leak.md) — http 插件 abort 后 fire-and-forget 取消，泄漏 "resource id N is invalid" 未捕获拒绝
- [28-http-scope-is-unix-glob](./28-http-scope-is-unix-glob.md) — Tauri http scope 是 UNIX glob 不是 URLPattern，"任意 https 主机"写 `https://*`
- [29-voice-stt-fetch-and-ipc-bytes](./29-voice-stt-fetch-and-ipc-bytes.md) — 跨源请求必须走 cleanTauriFetch（CSP + CORS 双杀直连）；Rust 返回 Vec<u8> 到 JS 是数字数组
- [30-webview-csp-coep-block-external-img](./30-webview-csp-coep-block-external-img.md) — webview 的 CSP + COEP 双杀外链图片，文章图片要走 Rust 侧 `img:` 自定义 scheme 代理并回 CORP 头；代理还得带文章自己的 URL 作 Referer，否则 CDN 防盗链回 403
- [54-plugin-http-body-json-per-byte](./54-plugin-http-body-json-per-byte.md) — 交给 http 插件的 body 被逐字节 JSON 化（实测 3.54 字符/字节，一次请求 ~20 倍自身大小），26 MB 的书上传峰值 400 MB 触发 iPad jetsam；大 blob 必须分块 PUT
- [72-arxiv-sortby-submitteddate-hangs](./72-arxiv-sortby-submitteddate-hangs.md) — arXiv 加 `sortBy=submittedDate` 25 秒不返回或 429，六个请求就把 IP 限流几分钟；"最新"要用 `submittedDate` 区间过滤，四个文献库一律"新是过滤、排序留给相关性"（OpenAlex 按日期排序会把管理学论文排到神经科学查询第一位）
- [73-s2-citation-edges-null-and-ignored-year](./73-s2-citation-edges-null-and-ignored-year.md) — S2 的 `/references`、`/citations` 会回 `data: null`（出版商抽掉字段，照文档写就抛 TypeError），`year=` 参数静默忽略；引用图往后由 S2 领跑、往前只有 OpenAlex 能服务端过滤加排序，空结果必须能降级到下一个库

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
- [43-webkit-tap-highlight-orphan-shadow](./43-webkit-tap-highlight-orphan-shadow.md) — 不引 preflight 也就没关掉 WKWebView 的原生点击高亮；点完即卸载的按钮会留下孤儿阴影。引入 preflight 后自动消失，手写那条已删；按下反馈仍要用 active:（同族的坑 49 反过来，preflight 管不着，收在「触摸与手势」）
- [67-webkit-tap-does-not-focus-a-button](./67-webkit-tap-does-not-focus-a-button.md) — WebKit 点击不给按钮焦点，靠 `.focus()` + `onBlur` 收起的二次确认在 iPad 上按了等于没按（blur 抢在 click 前面解除武装，React 又复用同一个 button 节点，这一下变成解除再武装）；收起改用 document 上 capture 的 pointerdown
- [69-visibilitychange-misses-window-switching](./69-visibilitychange-misses-window-switching.md) — 切到别的窗口再切回来不发 `visibilitychange`（页面一直是 visible），只有最小化和 unmap 才翻；`present()` 之后焦点还会回弹补一个 `blur`。"在前台"要当状态维护（visible && focused，四个事件一起），离开那侧要便宜、回来那侧要有下限
- [94-a-bare-anchor-navigates-the-whole-app-away](./94-a-bare-anchor-navigates-the-whole-app-away.md) — 不注册 `on_navigation` 的 Tauri app 里，AI 回答中一个裸 `<a href>` 就把 webview 导航到外站，书和对话一起丢；带 `target="_blank"` 的那条被 opener 插件的注入脚本接管，却被 `opener:allow-open-url` 的 scope 静默拒掉。Rust 侧加导航拦截 + 前端显式 `openUrl` + 放开 opener scope，Rust 里必须用 `OpenerExt::opener()`（自由函数 `open_url` 在 iOS 上不工作）
- [98-tauri-replaces-window-confirm-with-a-promise](./98-tauri-replaces-window-confirm-with-a-promise.md) — dialog 插件的 init 脚本把 `window.confirm` 换成 async 版本，返回的 Promise 恒为真值（`lib.dom.d.ts` 仍写 `boolean`，tsc 全绿），`if (!confirm(...)) return` 形同虚设；那次 invoke 还被 ACL 拒掉，只留一条没人接的 rejection。破坏性确认一律走 AlertDialog
- [99-on-navigation-sees-every-frame-and-cancels-in-silence](./99-on-navigation-sees-every-frame-and-cancels-in-silence.md) — `on_navigation` 拿到的是每个 frame 的导航（WKWebView 不看 `targetFrame`，WebKitGTK 的 NavigationAction 含子框架；Windows 只接顶层，反而盖不到 iframe），而取消是静默的：没有 error、不算 CSP 违规、控制台无输出。`blob:` 放行（自己页面的产物），`data:` 继续取消，所有 Cancel 打日志

## 界面与布局

- [68-overflow-x-auto-clips-the-other-axis](./68-overflow-x-auto-clips-the-other-axis.md) — 手机上让工具条横滑的那条 `overflow-x-auto` 把 `overflow-y` 也变成裁剪，带子里的下拉浮层整个看不见，z-index 救不了；浮层改 `fixed` + 开面板时量锚点矩形
- [75-split-tailwind-import-sorts-base-last](./75-split-tailwind-import-sorts-base-last.md) — 拆开 import 的 Tailwind 少了 `@layer theme, base, components, utilities;` 那行声明，layer 顺序按物理位置排，preflight 落到 utilities 后面，反过来压过每一个 utility class；验收看产物里 `@layer` 的首次出现顺序
- [76-paged-strip-rides-the-line-box-strut](./76-paged-strip-rides-the-line-box-strut.md) — 翻页模式的页带是 inline-block，竖向落点被继承来的 `line-height` 拉动；preflight 的 1.5 把整页挪了 1px（竖排模式逐字节不变）。以后动全局排版要单独复测翻页
- [77-abspos-in-a-button-starts-from-its-centre](./77-abspos-in-a-button-starts-from-its-centre.md) — 只写 `top` 不写 `left` 的绝对定位子元素放在 `<button>` 里，静态位置在按钮水平中心（Chrome 给按钮内容包了匿名居中盒），开关圆点偏了半个轨道宽；给按钮显式 `display` 或给子元素显式 `left`
- [78-tailwind-merge-only-dedupes-identical-modifier-chains](./78-tailwind-merge-only-dedupes-identical-modifier-chains.md) — `cn()` 只在修饰符串一模一样时才去重，`can-hover:hover:` 覆盖不掉 `can-hover:enabled:hover:`，两条都留下按特异性决胜；`data-[orientation=vertical]:h-full` 同理压过 `h-5`
- [79-entry-chunk-reinjects-its-own-stylesheet](./79-entry-chunk-reinjects-its-own-stylesheet.md) — Vite 入口 chunk 运行期再插一遍原始样式表，改 HTML 里的 `<link>` 指向改造过的副本无效；要整份 dist 复制后原地改 CSS
- [74-fixed-overlay-misses-shell-safe-area](./74-fixed-overlay-misses-shell-safe-area.md) — `position: fixed` 的包含块是视口，外壳按 `env(safe-area-inset-*)` 加的 padding 对它不存在，设置页被灵动岛压住、toast 落在 home indicator 上；`env()` 收进 `src/styles.css` 一组 `@utility`（`p-safe` / `pt-safe-*` / `bottom-safe-*` / `anchor-safe`），取 max(原有间距, inset) 而不是相加
- [80-portalled-overlay-trips-the-host-outside-press](./80-portalled-overlay-trips-the-host-outside-press.md) — Radix 浮层 Portal 到 `<body>`，宿主那条「点外面就关」的 `pointerdown` 把落在对话框按钮上的第一按判成点外面，气泡先关、按钮收不到 click；改成全局层级计数 `overlayLayerOpen()`，有层开着就整条让路
- [81-shadcn-add-rewrites-the-components-it-depends-on](./81-shadcn-add-rewrites-the-components-it-depends-on.md) — `shadcn add alert-dialog` 顺手把手写过的 `button.tsx` 换成默认那份（紫色、44px、`can-hover:` 全没），输出里只有一行 "Updated"；add 完先看 `git status`
- [82-duration-200-alone-transitions-every-property](./82-duration-200-alone-transitions-every-property.md) — `duration-*` 不设 `transition-property`，初始值 `all` 让这个元素每个属性都走 200ms 过渡；量计算样式要等满动画时长，否则读到过程值
- [84-js-cannot-read-env-safe-area-inset](./84-js-cannot-read-env-safe-area-inset.md) — 自定义属性里的 `env(safe-area-inset-*)` 从 `getComputedStyle` 拿回来还是那串原文，`parseFloat` 得 NaN；要读数字得让真属性吃掉它（隐藏探针元素的 padding），只有夹取在 JS 里的浮层才需要
- [85-collision-padding-does-not-save-an-anchor-inside-the-inset](./85-collision-padding-does-not-save-an-anchor-inside-the-inset.md) — `limitShift()` 不让浮层脱离锚点，锚点贴着视口边缘时菜单只能退到锚点边缘；锚定型浮层最多和它的锚点一样安全，外壳的 `p-safe` 才是根
- [86-transformed-popper-drops-subpixel-text](./86-transformed-popper-drops-subpixel-text.md) — popper 的 `transform` 让浮层成为合成层，字从次像素抗锯齿变灰度，逐像素对比每一行文字都在差异图上发亮；两边都加 `--disable-lcd-text` 再比
- [87-aschild-concatenates-classnames](./87-aschild-concatenates-classnames.md) — `asChild` 把包装组件和子元素的 className 拼成一串而不是过 `cn()`，写在子元素上的 `font-bold` 压不掉默认的 `font-semibold`，谁赢看 Tailwind 的排序；样式一律写在包装组件上
- [88-radix-dialog-keeps-the-scroll-lock-on-the-overlay](./88-radix-dialog-keeps-the-scroll-lock-on-the-overlay.md) — `RemoveScroll` 包在 `DialogOverlay` 里，不渲染 Overlay 就没有滚动锁，`modal={true}` 也没用（它只管焦点陷阱、`aria-hidden` 和外部指针）；全屏页正好不需要那把锁
- [89-portalled-overlay-leaves-the-phone-sliding-surface](./89-portalled-overlay-leaves-the-phone-sliding-surface.md) — Portal 出去的全屏页既不跟着手机壳的 `transform` 平移（`fixed` 的包含块回到视口），也接不到挂在那个元素上的手势监听；全屏那种 content 渲染在原地，`Dialog.Portal` 本来就是可选的
- [90-leading-normal-is-not-the-inherited-line-height](./90-leading-normal-is-not-the-inherited-line-height.md) — shadcn 的文本原语自带 `leading-none`，还原原来的行高要写 `leading-normal`（1.5，preflight 给 `html` 的那个），`leading-[normal]` 是字体建议行距、少 3px
- [91-select-item-aligned-ignores-the-safe-area-recipe](./91-select-item-aligned-ignores-the-safe-area-recipe.md) — shadcn 生成的 `SelectContent` 是 `position="item-aligned"`，不发布 `--radix-popper-available-*` 也不收 `collisionPadding`，`OVERLAY_SAFE.anchored` 和安全区那半全部静默失效；写死 `position="popper"`
- [93-a-select-trigger-is-as-wide-as-the-chosen-value](./93-a-select-trigger-is-as-wide-as-the-chosen-value.md) — 原生 `<select>` 按最宽的 option 定宽，Radix 的 trigger 只装选中那一行，换值就跳宽；把所有选项零高 `invisible` 叠进同一个 grid 单元格占住列宽
- [95-button-swallows-the-ref](./95-button-swallows-the-ref.md) — shadcn 生成的是 React 19 风格的函数组件，React 18 下 `<Button ref>` 恒为 `null`，类型全绿、生产构建无警告；已全部改成 `forwardRef`，护栏是 `tests/ui/components/forward-ref-contract.test.ts`，一次 `shadcn add` 就会写回来

## AI 调用与上下文窗口

- [64-replayed-assistant-timestamp-without-usage](./64-replayed-assistant-timestamp-without-usage.md) — 重放的 assistant 消息缺 `timestamp` 和 `usage` 正好绕开 pi 的估算路径；单补 `timestamp` 会让 `clampMaxTokensToContext` 在每一次 AI 调用里抛 TypeError，全 app 的 AI 当场全死
- [65-pi-clamps-max-tokens-to-one-and-calls-it-done](./65-pi-clamps-max-tokens-to-one-and-calls-it-done.md) — 上下文接近窗口时 pi 把允许输出夹到 1，模型吐一个 token 就停，`done` 正常发出、没有 error；聊天里是一个字的回复，解析 JSON 的地方变成"格式错误"。pi 的估算器还是 `chars/4`，中文低估 2.5–4 倍，最该收紧时放行。发请求前自己算，见 `src/budget/`
- [66-usage-shortcut-freezes-pi-context-estimate](./66-usage-shortcut-freezes-pi-context-estimate.md) — 消息数组里一旦有带 usage 的真 assistant 消息，pi 的估算就等于那个 usage，系统提示词不再计入，压缩 usage 之前的任何东西都不改变它；重放历史里那条没 timestamp 的 assistant 消息又会把捷径整个关掉（NaN 比较），同一个调用点两套计价。判断压缩够不够只能重新量，不能拿字符估的 saving 去减

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
