# 坑清单

踩过一次才知道的意外行为。一坑一文件，格式：现象 / 原因 / 解法。踩到新坑就加一个文件，并加进下面对应的一组。

按主题分组，动哪块扫哪组：

| 你要动的 | 扫这几组 |
|---|---|
| 阅读引擎、页面渲染、滚动定位 | EmbedPDF 引擎 |
| 标注的颜色、不透明度、创建与导入 | EmbedPDF 引擎 |
| iPad 触摸、笔、缩放、翻页 | 触摸与手势 + EmbedPDF 引擎 |
| 手机上的手势、页面导航 | 触摸与手势 |
| 鼠标滚轮、触控板 pinch | 触摸与手势 |
| 发请求、外链资源、CSP | 网络与 CSP |
| 改 deck / 幻灯片的宿主桥、iframe srcdoc | 网络与 CSP |
| 读写 AppData | 存储与数据目录 |
| 导入外部文件、拿文件选择器给的路径 | 存储与数据目录 |
| 同步引擎、Drive 后端 | 存储与数据目录 + 网络与 CSP + WebKit / webview |
| 全文/图片提取、裁图 | 提取（壳侧 pdf.js） |
| 出 iOS 包、签名、图标、深链接 | iOS 构建与签名 + 开发环境 |
| 动 CI 的构建缓存、靠 build script 生成的东西 | iOS 构建与签名 |
| 原生录音、回声消除、后台识别 | 原生音频与语音 |
| 写 CJK 字符类、抄一段带非 ASCII 边界的正则 | 原生音频与语音 |
| 出 Android 包、签名、对齐 | Android 构建与签名 |
| 桌面 webview 行为异常 | WebKit / webview |
| 隐藏 webview 取正文、反爬、UA、站点登录与退出 | WebKit / webview + 网络与 CSP |
| 渲染链接、点外链、开系统浏览器 | WebKit / webview |
| 清洗第三方 HTML、往 innerHTML 里塞正文 | WebKit / webview |
| 确认框、删除之类的破坏性操作 | WebKit / webview |
| 调模型、改 provider 层、组装提示词、加长上下文 | AI 调用与上下文窗口 |
| 顶栏、工具条、下拉浮层的定位 | 浮层与 shadcn 原语 |
| 全局样式、Tailwind layer、字体与行高 | 排版基线与 Tailwind + EmbedPDF 引擎 |
| 加测试文件、给 store 写单测 | 开发环境 |
| 搬目录、切子域、动分层表 | 开发环境 |
| 拿 grep 判断"这东西没人用"、按结论删代码 | 开发环境 |
| 在 worktree 里起 dev server 做实验 | 开发环境 |
| 查滚动卡顿、主线程占用 | WebKit / webview + EmbedPDF 引擎 |
| 渲染 AI 回复的 markdown、加 remark/rehype 插件 | markdown 渲染 |
| 无头截图核对渲染 | 开发环境 |
| 开机自启、托盘、常驻 | 开发环境 |

末尾的「历史」是换引擎前留下的，日常不用扫。

编号只加不回收：删掉的坑、或 2026-08-21 那次给撞号坑腾地方用掉的号，都不再复用；新坑接着当前最大编号往后加（下一个是 174）。

## EmbedPDF 引擎

- [18-embedpdf-load-hangs-progress-zero](./18-embedpdf-load-hangs-progress-zero.md) — 文档加载静默卡 progress 0，解法是跨源隔离头 + 直连引擎（worker:false）；归因是错的：pdfium.wasm 不是 pthread 构建，不需要 SharedArrayBuffer，worker 那次挂在根相对 wasmUrl（坑 21）
- [19-embedpdf-initialdocuments-hang](./19-embedpdf-initialdocuments-hang.md) — initialDocuments 卡 loading，改成 init 后显式 openDocumentBuffer
- [20-embedpdf-renderlayer-eats-pointer](./20-embedpdf-renderlayer-eats-pointer.md) — RenderLayer 的 img 吃指针事件，划词失效，需 pointerEvents:none
- [21-embedpdf-worker-engine-hangs](./21-embedpdf-worker-engine-hangs.md) — worker 引擎拿根相对 wasmUrl 会永久挂起（blob: 基址解不了根相对路径，错误 post 成主线程不认的消息类型），wasmUrl 要用 `location.href` 拼绝对地址；旧文档归因到 pthread 辅助 worker，是错的
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
- [96-the-page-gap-is-not-a-css-length](./96-the-page-gap-is-not-a-css-length.md) — 页间距是未缩放页单位，DOM 的 `gap` 和 virtual items 的步长是同一个数，用 CSS 压掉就让模型和屏幕对不上；只能调注册期的 `defaultPageGap`，且不能为 0（翻页模式靠它把邻页挡在屏外）
- [97-the-spike-harness-measured-a-different-box-model](./97-the-spike-harness-measured-a-different-box-model.md) — harness 不 import `styles.css`，没有 preflight 的 `border-box`，滚动容器比窗口宽 2×gap；引擎调试入口要和 app 用同一份全局基线才量得准
- [100-the-viewport-gap-is-charged-twice](./100-the-viewport-gap-is-charged-twice.md) — `viewportGap` 同时是页面四周的 padding、每个 fit 的减数（`clientWidth - 2*gap`）和每个 `scrollToPage` 的加数，改留白就是改整套几何；传 0 能生效只因为 reducer 初值也是 0（`if (config.viewportGap)` 根本不 dispatch）
- [101-page-coordinates-are-a-scroll-offset-on-both-axes](./101-page-coordinates-are-a-scroll-offset-on-both-axes.md) — `scrollToPage` 的 `pageCoordinates.x` 会原样加进水平滚动位置，`alignX` 不传就没人减回去；跳到标注时页面被拉走"标注离页左边缘多远"那么多（实测 60px），左边距的标注偏一点、右半页的标注偏半屏。跳到页内某点一律显式补 `alignX`：页面放得下就居中页面（`x` 传 0），放大到超出视口就居中标注（`x` 传标注 x、`alignX` 传 50）
- [102-render-quality-option-is-read-under-another-name](./102-render-quality-option-is-read-under-another-name.md) — `renderPage` 的 `imageQuality` 调 0.01 和 1.0 出来一样大：编码器读的是 `options.quality`（类型里没有这个字段），质量永远落在 canvas 默认；两个名字都传
- [105-markup-is-drawn-from-strokecolor-and-tool-opacity](./105-markup-is-drawn-from-strokecolor-and-tool-opacity.md) — 高亮/下划线渲染读的是 `strokeColor`（`color` 是 deprecated 别名），只写 `color` 就画成兜底黄；不透明度又分两处（导入写死 0.4、创建取工具默认值 1），于是刚划的那一下深、重开变浅，两次都不是选的那个颜色。颜色两个字段一起写，不透明度收成一个数、注册期用 `tools` 覆盖工具默认值
- [138-the-open-task-resolves-before-the-document-lands](./138-the-open-task-resolves-before-the-document-lands.md) — `openDocumentBuffer` 的外层 task 在 dispatch 完就 resolve，文档要等内层引擎 task 才进 store；直连引擎同微任务内完成看不出来，worker 下 `getDocument` 读到 null，宿主整半边接线被跳过（页面照画、顶栏说打不开）。两层都 await，不用轮询
- [139-encoderpoolsize-is-only-read-by-the-worker-engine](./139-encoderpoolsize-is-only-read-by-the-worker-engine.md) — 两个引擎共用同一份选项类型，但直连版写死主线程 canvas 编码、从不读 `encoderPoolSize`，传了等于没传；要编码池只能用 worker 引擎（`ImageEncoderWorkerPool` 不在包的 exports 里，拼不出来）
- [140-buffersize-widens-the-window-it-does-not-move-it](./140-buffersize-widens-the-window-it-does-not-move-it.md) — `bufferSize` 只决定预取窗口多宽，`endIndex + bufferSize - 1` 在 1 时已经提前一页；调大只多常驻几张光栅，停顿时刻分毫不动。小 fixture 上调到 ≥ 页数会整本预渲染完，量出一组假数字
- [150-restoring-a-scale-nobody-saved-overrides-fit-width](./150-restoring-a-scale-nobody-saved-overrides-fit-width.md) — 没开过的书也带着一个合成的 viewState 进来，`scale: "auto"` 这个哨兵在壳里被折成数字 1，`requestZoom(1)` 当场作废注册时的 `FitWidth`，第一次开书停在 100%、改窗口也不再重新适配；"没存过的缩放"要一路保持"没有"，还原判据收进纯函数 `openingZoom`

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
- [117-webkit-takes-the-scroll-later-and-only-on-a-scrollable-axis](./117-webkit-takes-the-scroll-later-and-only-on-a-scrollable-axis.md) — 坑 70、71 的四个数在 iOS WKWebView 上一个都不成立：`touchmove` 从第一个像素就发、约 16px 才判滚动（其间每个 move 都 cancelable）、只 prevent 第一个 move 就够、而且只抢它真能滚的那个轴；3px 和「每个 move 都 prevent」是两个引擎的交集，不用改
- [128-react-onwheel-is-passive](./128-react-onwheel-is-passive.md) — React 18 把 `wheel`/`touchstart`/`touchmove` 按 passive 挂在 root 上，`onWheel` 里的 `preventDefault()` 被忽略，自己的缩放和浏览器的页面缩放同时跑；要手挂原生监听并显式 `{ passive: false }`
- [129-wheel-delta-comes-in-three-units](./129-wheel-delta-comes-in-three-units.md) — `deltaY` 的单位由 `deltaMode` 说了算（像素/行/页），行模式一格约 3，只按像素累计的手势在那种引擎上要拨十几下才动一格；累加前先归一到像素
- [137-zoom-plugin-wheel-is-ctrl-only-and-doubles-per-notch](./137-zoom-plugin-wheel-is-ctrl-only-and-doubles-per-notch.md) — 缩放插件的 `enableWheel` 只是 ctrl/meta+滚轮的开关（裸滚轮在 handler 第一行就返回，从来不归它管），关掉它等于白白没有桌面缩放；步长是 `1 - deltaY*0.01` 且没有灵敏度选项，Chromium 一格 100px 就翻倍，只能自己接管，用 `exp(-px/800)` 一条指数曲线同时喂鼠标和触控板
- [143-ios-puts-its-selection-callout-below-the-selection](./143-ios-puts-its-selection-callout-below-the-selection.md) — iPad 上系统的 `Copy | Look Up | Translate` 条不是固定在选区上方：选区中心在安全区竖向中点以上时它在下方，以下时在上方，两边都是离选区 15px、高 44px，横向对着选区中心夹进屏幕。它是浮在 WKWebView 上的 UIKit 视图，DOM 里没有、`elementFromPoint` 看不见、落在它上面的触摸网页收不到；贴着选区放的浮动控件被盖掉 37px 只剩 7px 可点。那个控件已删（作废 2026-08-20），再往选区旁边放东西要按这条带子两边都让并重新量

## 网络与 CSP

- [15-plugin-http-forced-origin](./15-plugin-http-forced-origin.md) — Tauri http 插件强制补 Origin，Anthropic 视其为 CORS 请求
- [26-plugin-http-abort-resource-id-leak](./26-plugin-http-abort-resource-id-leak.md) — http 插件 abort 后 fire-and-forget 取消，泄漏 "resource id N is invalid" 未捕获拒绝
- [28-http-scope-is-unix-glob](./28-http-scope-is-unix-glob.md) — Tauri http scope 是 UNIX glob 不是 URLPattern，"任意 https 主机"写 `https://*`
- [29-voice-stt-fetch-and-ipc-bytes](./29-voice-stt-fetch-and-ipc-bytes.md) — 跨源请求必须走 cleanTauriFetch（CSP + CORS 双杀直连）；Rust 返回 Vec<u8> 到 JS 是数字数组
- [30-webview-csp-coep-block-external-img](./30-webview-csp-coep-block-external-img.md) — webview 的 CSP + COEP 双杀外链图片，文章图片要走 Rust 侧 `img:` 自定义 scheme 代理并回 CORP 头；代理还得带文章自己的 URL 作 Referer，否则 CDN 防盗链回 403
- [54-plugin-http-body-json-per-byte](./54-plugin-http-body-json-per-byte.md) — 交给 http 插件的 body 被逐字节 JSON 化（实测 3.54 字符/字节，一次请求 ~20 倍自身大小），26 MB 的书上传峰值 400 MB 触发 iPad jetsam；大 blob 必须分块 PUT
- [72-arxiv-sortby-submitteddate-hangs](./72-arxiv-sortby-submitteddate-hangs.md) — arXiv 加 `sortBy=submittedDate` 25 秒不返回或 429，六个请求就把 IP 限流几分钟；"最新"要用 `submittedDate` 区间过滤，四个文献库一律"新是过滤、排序留给相关性"（OpenAlex 按日期排序会把管理学论文排到神经科学查询第一位）
- [73-s2-citation-edges-null-and-ignored-year](./73-s2-citation-edges-null-and-ignored-year.md) — S2 的 `/references`、`/citations` 会回 `data: null`（出版商抽掉字段，照文档写就抛 TypeError），`year=` 参数静默忽略；引用图往后由 S2 领跑、往前只有 OpenAlex 能服务端过滤加排序，空结果必须能降级到下一个库
- [152-srcdoc-iframe-inherits-the-parent-csp](./152-srcdoc-iframe-inherits-the-parent-csp.md) — `srcdoc`（和 `blob:`）iframe 不过 `frame-src`，CSP 从父页继承：deck 的内联脚本是靠 app 自己的 `script-src 'unsafe-inline'` 在跑；22 MB 的 srcdoc load 415 ms，CSP 一个字不用改

## 存储与数据目录

- [09-appdata-glob-capability](./09-appdata-glob-capability.md) — Tauri 权限 glob 不匹配目录本身；且持久化失败绝不静默吞
- [36-appdata-root-not-created-first-write](./36-appdata-root-not-created-first-write.md) — iOS 首装首跑第一个写入者报 os error 2，数据根目录由 Rust setup 的 create_dir_all 保障，前端不再各自兜底
- [51-sync-stopped-looks-healthy](./51-sync-stopped-looks-healthy.md) — 凭据文件不在，引擎从不启动，`autoSync:true` + `lastError:null` 读起来完全健康，四天没人发现；启动的三选一和「该说什么」都收进 `platform/sync/health.ts`
- [52-all-or-nothing-pass-never-completes](./52-all-or-nothing-pass-never-completes.md) — 一趟同步一个文件失败就整趟中止，丢包链路上 51 个请求的一趟几乎不可能跑完，`Last sync: Never`；改逐项 + 缓存 id 遇 404 自愈 + 重试超时
- [53-identical-rewrite-wins-whole-file](./53-identical-rewrite-wins-whole-file.md) — app 用相同内容重写文件，按 mtime 判就是本地有改动，整文件 LWW 让"只是重存了一次"的设备静默覆盖掉另一台的批注；改内容 hash 判变更 + 三方合并
- [106-ios-hands-over-a-percent-encoded-file-url](./106-ios-hands-over-a-percent-encoded-file-url.md) — iOS 文件选择器返回 percent-encoded 的 `file://` URL，`basename` 切出来的书名是 `%E5%85%A8...`；归一化收在 `addFileToTopic` 一道门，脏数据按"不变就不写"的纯函数读取时自愈

## 提取（壳侧 pdf.js）

- [24-pdfjs-operatorlist-needs-dom](./24-pdfjs-operatorlist-needs-dom.md) — getOperatorList/render 要 DOMMatrix，只能在 webview 跑，bun 测试只覆盖纯函数；另附矢量图 bbox 的算子解析细节
- [25-embedpdf-no-region-raster](./25-embedpdf-no-region-raster.md) — EmbedPDF 适配层没有区域截图，图片裁剪改用自带 pdf.js 渲染

## iOS 构建与签名

- [31-ios-deep-link-scheme-build-time](./31-ios-deep-link-scheme-build-time.md) — 自定义 scheme 只能构建期静态注册进 tauri.conf，不能靠 env，且要和 env client id 手工对齐
- [157-a-cached-crate-never-replays-its-build-script](./157-a-cached-crate-never-replays-its-build-script.md) — 依赖 crate 命中 rust-cache 就不重新编译，它 build script 写进 `gen/apple/Info.plist` 的 `CFBundleURLTypes` 也就没人写；`gen/apple` 每次现生成，于是 build 48/53 发出去才发现 Google 回调回不来。CI 自己从 tauri.conf 注入（幂等），并在 ipa 的 binary plist 上断言，缺 scheme 就红
- [33-ios-no-cross-origin-isolation-still-renders](./33-ios-no-cross-origin-isolation-still-renders.md) — iOS WKWebView 自定义协议下没有跨源隔离/SAB，PDFium 照样渲染（wasm 本就不是 pthread 构建，worker 引擎也不需要 SAB）；闸门可在模拟器无签名验证
- [34-ios-init-default-icon-alpha](./34-ios-init-default-icon-alpha.md) — tauri ios init 用内置默认图标模板，CI init 后要覆盖 appiconset；iOS 图标 strip alpha，CFBundleIconName 兜底
- [35-ios-unsigned-linkedit-vmsize](./35-ios-unsigned-linkedit-vmsize.md) — 完全无签名 Mach-O 过第三方重签名器时 __LINKEDIT vmsize 不更新，真机秒崩；产线预 ad-hoc 签名规避
- [47-asc-key-role-cloud-signing](./47-asc-key-role-cloud-signing.md) — CI 云签名要 Admin 权限的 App Store Connect API key，App Manager 在 export 阶段被拒；试探权限不能用坏 payload
- [48-tauri-ios-signing-log-noise](./48-tauri-ios-signing-log-noise.md) — "找不到证书"警告和 `Apple Distribution: Tauri (unset)` 证书都是 Tauri 自己的噪音，签名成没成看 export 阶段
- [107-testflight-upload-is-not-distribution](./107-testflight-upload-is-not-distribution.md) — altool 上传成功只是 ingest，build 不 link 到 beta 组就谁也装不到（内测组没开自动分发要逐个加，外测组还要 What's New 和 beta 审核）；上传后必须跑分发脚本。外测加组 404 说 build 不存在：端点要用 builds 那一侧、审核提交要排在加组前面、先查 `buildAudienceType` 和 `externalBuildState`。`fields[builds]` 漏列 relationship 会把 `include` 的数据一起吞掉。上传返回时 build 资源还没建出来，要等它出现和等它 VALID 两段轮询，且不许猜「最新那个」
- [163-idevicesyslog-drops-lines-when-it-is-not-filtered](./163-idevicesyslog-drops-lines-when-it-is-not-filtered.md) — 不加过滤的 `idevicesyslog` 四分钟落盘 127MB，里面自己 app 的 NSLog 只有 13 行：设备日志本身 0.5MB/s，中继跟不上就丢，丢哪段不挑。用 `-m/--match` 在中继侧过滤，判据是行数不是文件大小

## Android 构建与签名

- [104-zipalign-page-size-flag-needs-build-tools-35](./104-zipalign-page-size-flag-needs-build-tools-35.md) — `zipalign -P 16`（16 KB 页对齐）是 build-tools 35 才加的参数，34.0.0 上直接退 2；对齐真正来自 NDK r28+，产物上用 readelf 逐段断言

## 原生音频与语音

- [132-audio-engine-start-returns-without-running](./132-audio-engine-start-returns-without-running.md) — `AVAudioEngine.start()` 不 throw 也照样没起来，`isRunning` 是 false、tap 一个回调都不触发，采集全程静默且零报错；`start()` 之后自己断言 `isRunning`，错误信息里带输出链接受的格式、输出节点的硬件格式和会话 `sampleRate`
- [133-a-rebuilt-vpio-unit-answers-with-a-default-output-format](./133-a-rebuilt-vpio-unit-answers-with-a-default-output-format.md) — `setVoiceProcessingEnabled(true)` 重建 IO 单元之后、`prepare()` 之前，输出侧对硬件的回答是 44100Hz 2ch 默认值；`mainMixerNode` 第一次被读到就会建出来并接上输出节点，接在 `prepare()` 之前整条输出链按默认值定死，引擎起不来（表现即坑 132）。`prepare()` 排在第一次访问 `mainMixerNode` 之前，硬件格式读 `outputNode.outputFormat(forBus:)`
- [158-asset-installation-request-is-never-nil](./158-asset-installation-request-is-never-nil.md) — 模型已装，`AssetInventory.assetInstallationRequest(supporting:)` 照样每次返回非 nil；`downloadAndInstall()` 对已装 locale 是 4-40ms 的空操作，真下载是分钟级。别把「非 nil」当成「要下载」去给用户看进度
- [159-finalize-hangs-when-another-instance-holds-the-session](./159-finalize-hangs-when-another-instance-holds-the-session.md) — 健康会话上 `finalizeAndFinishThroughEndOfInput()` 是 70-330ms，另一个 app 实例占着会话时实测挂了 89 秒；三个命令共用一条串行链，链头挂住后面每一次按住说话都排队干等。给 finalize 设 2 秒上限（用一次性闩，不能用 task group：Swift 放弃不了「等另一个 Task 结束」的 await），装包前先按 pid 杀掉旧实例
- [160-volatile-results-arrive-in-bursts](./160-volatile-results-arrive-in-bursts.md) — 开了 `fastResults` 之后 volatile 成串到达，同一毫秒六条、每条比上一条多几个字符，每条都是一次 IPC 加一次整棵重渲染；按住说话本来就不显示实时文字，所以累加器全收、往外发的节流到 10Hz，final 不许节流。顺带实测：volatile 只覆盖未定稿的尾巴，不是累计整句
- [161-the-tap-buffer-decides-the-level-rate](./161-the-tap-buffer-decides-the-level-rate.md) — 电平事件按 15Hz 节流，实测 9.6-10.0Hz：节流阈值比 tap 回调的到达间隔还短，一次都没生效，真正定频率的是 `installTap` 的缓冲区。要改频率去改 `bufferSize`。具体多大还没实测——请求的 4096 帧算出来是 11.7Hz，对不上，4800 帧才对得上；`bufferSize` 是请求不是契约，`consume()` 现在把实际帧数打进第一条日志
- [162-a-locked-screen-takes-the-microphone-without-an-interruption](./162-a-locked-screen-takes-the-microphone-without-an-interruption.md) — 自动锁屏把 app 切后台，输入路由变成 `in=[]`，麦克风再无一个 buffer，但 `interruptionNotification` 一条都不来、`isRunning` 还是 true；真手指按着屏幕不会锁，只有合成 pointer 事件的无人值守脚本会撞上——但引擎跨按住留着之后产品也撞得到，订阅 `didEnterBackgroundNotification` 把空闲的栈拆掉
- [164-the-wrong-dictation-locale-invents-rather-than-degrades](./164-the-wrong-dictation-locale-invents-rather-than-degrades.md) — 送错语种的模型不会「识别得差一点」，会按音节猜出一串语法通顺的目标语言词：中文「注意力机制取代了循环结构」按 en-US 出来是 `2 E D, teacher, Chidalo, Shun.`，十五秒的长句只剩一串逗号。看起来像正常输出，所以比空转写更难发现。不跟随设备语言，做成设置项（`settings.dictationLocale`，默认 zh-CN）
- [165-a-harness-that-buffers-cannot-report-the-crash-it-watches-for](./165-a-harness-that-buffers-cannot-report-the-crash-it-watches-for.md) — 探针把记录攒在内存里、跑完才落盘，就报不了它自己要抓的那种死法：jetsam、看门狗、锁屏挂起定时器都不给收尾机会，死在第十八分钟和从没开始过取回来是同一个空文件。按事件 `append` 一行 JSON，每条带墙钟时间戳；高频事件只计数不入账。有了它，跑多久就没那么要紧——死在第四分钟就是四分钟的数据
- [166-the-microphone-opens-after-the-user-has-started-talking](./166-the-microphone-opens-after-the-user-has-started-talking.md) — 按住说话丢头字：tap 装上之前没有麦克风，press 到第一个 buffer 实测一整秒，其中约 690ms 花在 `setVoiceProcessingEnabled(true)`，识别器那一半只占 80–180ms。2.6 秒的句子全对、2.4 秒的丢头，峰值电平 86-99%，看着像识别质量问题。把 `start()` 切成"先开麦克风、后备识别器"两半、中间垫 pre-roll 队列，冷启动收益为零（五次按住四次缓冲到 0 个 buffer）。解法是留着引擎不拆——28 次实测，复用 304ms（9/9 完整）对重建 1082ms（2/13 完整），丢头字消失；pre-roll 在复用形态下才第一次有东西可垫。`setPrefersEchoCancelledInput` 用不上：iPhone 16 上 `isEchoCancelledInputAvailable` 是 false，而且复用之后开不开 VPIO 差不出来
- [167-the-microphone-indicator-lights-at-engine-start](./167-the-microphone-indicator-lights-at-engine-start.md) — 橙点在 `engine.start()` 那一步亮，`setActive(true)` 那一步不亮（实测四档，Apple 对触发点零文档，推过两次都错）。意味着坑 166 那 690ms 没法提前付掉而不点亮橙点：VPIO 只有引擎跑起来才建得成。只剩两种形态——切进语音模式就起引擎（用户没开口橙点就亮），或第一次按住时建、之后不 `stop()` 只 `pause()`（橙点从第一次说话开始亮）。取后者，已落地：橙点在语音模式里一直亮，退出语音模式立刻灭
- [168-the-probe-parked-beside-the-thing-it-measures](./168-the-probe-parked-beside-the-thing-it-measures.md) — 橙点探针停在 `engine`/`tap`/`recording` 不撤，下一次按住先替它拆引擎，四百到八百毫秒记在 `session` 那一步上，21 次按住的一整轮数据作废（探针停 off/session 的 11 次全是 72-156ms，停在建了引擎那三档的 9 次全是 584-977ms，中间没有值）；顺带把上一次留着的引擎也清了，`reuse` 十次按住 `reused` 全 false。日志和字段全都正常，所以看不出来。解法是拒绝这次按住并在界面上说原因，不偷偷复位；判据是"上次按住之后碰过探针没有"而不是"探针现在停在哪一档"——`setIndicatorProbe(.off)` 自己也 teardown，提示人"先把探针关掉"等于亲手指挥人毁掉要复用的引擎；拆除动作放进被拒的那次按住里（它的数不算数），碰一次探针固定赔一次按住；每行记 `probeStage` 和 `probeTouched`，快路径没走成要写 `reuseSkipped`
- [170-a-regex-boundary-is-a-code-point-not-a-glyph](./170-a-regex-boundary-is-a-code-point-not-a-glyph.md) — CJK 字符类的边界 U+F900 和 U+8C48 渲染成同一个字形，抄成后者就把 U+8C48–U+FAFF 这 2.8 万个码点（谚文、彝文、私用区，加上没有 `u` 标志时每个 emoji 的前导代理）全算成 CJK，seam 该留的空格被吃掉；bench 只跑纯中文和纯英文，两种范围结论一致，测不出来。边界按码点读不按字形读

## WebKit / webview

- [12-webkitgtk-drag-latency](./12-webkitgtk-drag-latency.md) — WebKitGTK 拖选高亮时选区滞后于鼠标（根因未定，换引擎后没复测）
- [16-webkitgtk-clipboard-image](./16-webkitgtk-clipboard-image.md) — DOM paste 事件不带图片，贴图要从 Rust 读剪贴板
- [43-webkit-tap-highlight-orphan-shadow](./43-webkit-tap-highlight-orphan-shadow.md) — 不引 preflight 也就没关掉 WKWebView 的原生点击高亮；点完即卸载的按钮会留下孤儿阴影。引入 preflight 后自动消失，手写那条已删；按下反馈仍要用 active:（同族的坑 49 反过来，preflight 管不着，收在「触摸与手势」）
- [67-webkit-tap-does-not-focus-a-button](./67-webkit-tap-does-not-focus-a-button.md) — WebKit 点击不给按钮焦点，靠 `.focus()` + `onBlur` 收起的二次确认在 iPad 上按了等于没按（blur 抢在 click 前面解除武装，React 又复用同一个 button 节点，这一下变成解除再武装）；收起改用 document 上 capture 的 pointerdown
- [69-visibilitychange-misses-window-switching](./69-visibilitychange-misses-window-switching.md) — 切到别的窗口再切回来不发 `visibilitychange`（页面一直是 visible），只有最小化和 unmap 才翻；`present()` 之后焦点还会回弹补一个 `blur`。"在前台"要当状态维护（visible && focused，四个事件一起），离开那侧要便宜、回来那侧要有下限
- [94-a-bare-anchor-navigates-the-whole-app-away](./94-a-bare-anchor-navigates-the-whole-app-away.md) — 不注册 `on_navigation` 的 Tauri app 里，AI 回答中一个裸 `<a href>` 就把 webview 导航到外站，书和对话一起丢；带 `target="_blank"` 的那条被 opener 插件的注入脚本接管，却被 `opener:allow-open-url` 的 scope 静默拒掉。Rust 侧加导航拦截 + 前端显式 `openUrl` + 放开 opener scope，Rust 里必须用 `OpenerExt::opener()`（自由函数 `open_url` 在 iOS 上不工作）
- [125-a-regex-tag-matcher-ends-the-tag-early](./125-a-regex-tag-matcher-ends-the-tag-early.md) — 正则清洗器把标签当成到第一个 `>` 为止，双引号属性值里的 `>` 让 `<marquee title="a>" onstart=...>` 整条穿过去；删属性替换成空串又把 `on` 和 `click=alert(1)` 粘成输入里没有的处理器。改成 DOMParser 解析 + 白名单走树 + 重新写出标签；测试用 jsdom 给 bun 补 DOMParser，判定用 `HTMLRewriter` 问浏览器看到什么
- [126-a-sanitizer-that-is-safe-is-not-yet-stable](./126-a-sanitizer-that-is-safe-is-not-yet-stable.md) — 清洗器在读的时候也跑，同一条正文要过很多趟；属性值不转义 `&`，`https://&#101;vil.example/a.jpg` 下一趟就换了主机。判定要 `sanitize(sanitize(x)) === sanitize(x)` 逐字节相等，「清两遍都安全」比它弱；`HTMLRewriter` 报的是源码原文不解码实体，当裁判时看不出这类漂移。转义 `&` 之后，用正则读 `src` 的 image-proxy 要先反解
- [127-a-parsed-tree-written-back-does-not-reparse-to-itself](./127-a-parsed-tree-written-back-does-not-reparse-to-itself.md) — 把解析出来的树原样写回去，下一趟解析不一定还原：`<pre>` 后面的换行每趟被吃一个，`&#13;` 的 CR 变成 LF，起始标签会关掉已经开着的同类元素（scope boundary 被 unwrap、`h1`-`h6` 只看 current node 所以任何元素都是挡板、foster parenting 把 `<li>` 从表格里搬到外层 `<li>` 里）。前两个写出去时补偿，第三个不建模规则，维护输出侧的开启栈发现这种位置就重新喂给解析器；fuzz 必须嵌套且判据逐字节相等，平铺的 fuzzer 一条都发现不了
- [98-tauri-replaces-window-confirm-with-a-promise](./98-tauri-replaces-window-confirm-with-a-promise.md) — dialog 插件的 init 脚本把 `window.confirm` 换成 async 版本，返回的 Promise 恒为真值（`lib.dom.d.ts` 仍写 `boolean`，tsc 全绿），`if (!confirm(...)) return` 形同虚设；那次 invoke 还被 ACL 拒掉，只留一条没人接的 rejection。破坏性确认一律走 AlertDialog
- [99-on-navigation-sees-every-frame-and-cancels-in-silence](./99-on-navigation-sees-every-frame-and-cancels-in-silence.md) — `on_navigation` 拿到的是每个 frame 的导航（WKWebView 不看 `targetFrame`，WebKitGTK 的 NavigationAction 含子框架；Windows 只接顶层，反而盖不到 iframe），而取消是静默的：没有 error、不算 CSP 违规、控制台无输出。`blob:` 放行（自己页面的产物），`data:` 继续取消，所有 Cancel 打日志
- [108-a-modernised-user-agent-is-what-gets-you-blocked](./108-a-modernised-user-agent-is-what-gets-you-blocked.md) — 把 WebKitGTK 默认 UA 的 `Version/60.5` 换新、或只去掉 `Ubuntu;`、或换成 Chrome UA，彭博冷 profile 一律 403 + 验证码；显式 pin 成引擎默认那一整条才 200。PerimeterX 拿 UA 和引擎其他特征对账，任何偏离都不行
- [109-a-dead-host-never-fires-load-failed](./109-a-dead-host-never-fires-load-failed.md) — 域名解析不了时只发一个 `load-changed started`，25 秒不发 `load-failed` 也不发 `finished`；TLS 失败 1.3 秒就发。`network` 只能覆盖连上以后的失败，DNS 死掉的只能按 `timeout` 报
- [110-guessing-cookie-domains-misses-the-session](./110-guessing-cookie-domains-misses-the-session.md) — `delete_cookies_for_domain` 只匹配传进去那一个域名不含子域，按主机名拼出来的四种写法漏掉了 `login.<站点>` 上的会话 cookie；要读 `<profile>/cookies` 把该站实际存在的域名全捞出来再删，方向只往子域走不往父域走
- [111-webkit-writes-the-cookie-jar-on-its-own-schedule](./111-webkit-writes-the-cookie-jar-on-its-own-schedule.md) — 删完 cookie 内存干净了，盘上的 jar 还留着 13 行，下次启动读回来用户又是登录态（删除是 void 调用、落盘时机不归调用方管）；拿一次异步 cookie 读当 barrier 确认删除已处理，再自己重写 jar 文件，实测 48 行 → 0 行
- [112-wry-builds-its-own-window-for-a-popup](./112-wry-builds-its-own-window-for-a-popup.md) — `on_new_window` 设 `Allow` 之后，弹窗是 wry 自己建的 GTK 窗口：不是 Tauri 窗口、导航拦截看不到、拿不到句柄，而弹窗 `close()` 只销毁 webview 不销毁窗口（这半读源码得出，未验）；用 toplevel 快照差集在登录结束时清扫
- [113-two-harnesses-readings-are-not-a-before-and-after](./113-two-harnesses-readings-are-not-a-before-and-after.md) — 取正文硬等 15 秒的依据是「fetcher 拿到 735、spike 量到 1345」，可两个数出自两个 harness 且都等了 15 秒，说明不了读早了；实测正文在 `finished` 后第一次 poll（2ms / 55ms）就是全的、45 秒不变，下限值 0 个字符。判据要同 harness 前后对比，用 `RP_WEBVIEW_FETCH_TRACE` 录填充曲线一次回放所有候选规则
- [114-httponly-bot-cookies-land-before-load-finished](./114-httponly-bot-cookies-land-before-load-finished.md) — 预热睡 15 秒的理由是「PX 的 cookie 是 httpOnly 没东西可 poll」，但看不见的只是注入的 JS：WebKitGTK 边跑边把 jar 写到 `<profile>/cookies`，实测 `_px3` 在 +6.5s 就落盘，而那次 `finished` 60 秒没来。预热改成和取正文同一条判据（不再变化且不是拦截页，1.5 秒）
- [115-the-cookie-count-does-not-say-the-warm-up-worked](./115-the-cookie-count-does-not-say-the-warm-up-worked.md) — 预热改看 jar 之后，"该站 cookie 条数不再增长"两头都不成立：停在服务端那几条上的加载会被判成功（`_px3` 根本没来），热 profile 上重写 13 行而条数不变的加载会被判成什么都没发生；判据要看与顺序无关的行内容指纹变了几次，安静 6 秒（实测一次加载内部最宽间隔 3.25s，写完之后下一件事在 30 秒开外）
- [116-no-sign-in-control-is-not-a-session](./116-no-sign-in-control-is-not-a-session.md) — 「页面上还有没有登录入口」在登录窗口里两头不成立：彭博登录页上一个可点标签都不匹配（写的是 Continue），按这个信号读出来用户正在输密码的那页是"已登录"；未登录首页的登录入口第 2 次 poll（约 6 秒）才渲染出来，而 readyState 到 21 秒才 complete。要同站、非登录路径、字符数 ≥2000、且字符数不再变化连续两次才认
- [141-a-blocked-main-thread-stops-the-scroll-outright](./141-a-blocked-main-thread-stops-the-scroll-outright.md) — 主线程占多久屏幕就冻多久（90ms 阻塞冻 82-119ms），和挂不挂 wheel 监听、passive 与否无关，Chromium 同样冻；滚动路径上别占主线程，判据用屏幕像素不用页内计数

## 浮层与 shadcn 原语

- [68-overflow-x-auto-clips-the-other-axis](./68-overflow-x-auto-clips-the-other-axis.md) — 手机上让工具条横滑的那条 `overflow-x-auto` 把 `overflow-y` 也变成裁剪，带子里的下拉浮层整个看不见，z-index 救不了；浮层改 `fixed` + 开面板时量锚点矩形
- [80-portalled-overlay-trips-the-host-outside-press](./80-portalled-overlay-trips-the-host-outside-press.md) — Radix 浮层 Portal 到 `<body>`，宿主那条「点外面就关」的 `pointerdown` 把落在对话框按钮上的第一按判成点外面，气泡先关、按钮收不到 click；改成全局层级计数 `overlayLayerOpen()`，有层开着就整条让路
- [81-shadcn-add-rewrites-the-components-it-depends-on](./81-shadcn-add-rewrites-the-components-it-depends-on.md) — `shadcn add alert-dialog` 顺手把手写过的 `button.tsx` 换成默认那份（紫色、44px、`can-hover:` 全没），输出里只有一行 "Updated"；add 完先看 `git status`
- [85-collision-padding-does-not-save-an-anchor-inside-the-inset](./85-collision-padding-does-not-save-an-anchor-inside-the-inset.md) — `limitShift()` 不让浮层脱离锚点，锚点贴着视口边缘时菜单只能退到锚点边缘；锚定型浮层最多和它的锚点一样安全，外壳的 `p-safe` 才是根
- [86-transformed-popper-drops-subpixel-text](./86-transformed-popper-drops-subpixel-text.md) — popper 的 `transform` 让浮层成为合成层，字从次像素抗锯齿变灰度，逐像素对比每一行文字都在差异图上发亮；两边都加 `--disable-lcd-text` 再比
- [87-aschild-concatenates-classnames](./87-aschild-concatenates-classnames.md) — `asChild` 把包装组件和子元素的 className 拼成一串而不是过 `cn()`，写在子元素上的 `font-bold` 压不掉默认的 `font-semibold`，谁赢看 Tailwind 的排序；样式一律写在包装组件上
- [88-radix-dialog-keeps-the-scroll-lock-on-the-overlay](./88-radix-dialog-keeps-the-scroll-lock-on-the-overlay.md) — `RemoveScroll` 包在 `DialogOverlay` 里，不渲染 Overlay 就没有滚动锁，`modal={true}` 也没用（它只管焦点陷阱、`aria-hidden` 和外部指针）；全屏页正好不需要那把锁
- [89-portalled-overlay-leaves-the-phone-sliding-surface](./89-portalled-overlay-leaves-the-phone-sliding-surface.md) — Portal 出去的全屏页既不跟着手机壳的 `transform` 平移（`fixed` 的包含块回到视口），也接不到挂在那个元素上的手势监听；全屏那种 content 渲染在原地，`Dialog.Portal` 本来就是可选的
- [91-select-item-aligned-ignores-the-safe-area-recipe](./91-select-item-aligned-ignores-the-safe-area-recipe.md) — shadcn 生成的 `SelectContent` 是 `position="item-aligned"`，不发布 `--radix-popper-available-*` 也不收 `collisionPadding`，`OVERLAY_SAFE.anchored` 和安全区那半全部静默失效；写死 `position="popper"`
- [93-a-select-trigger-is-as-wide-as-the-chosen-value](./93-a-select-trigger-is-as-wide-as-the-chosen-value.md) — 原生 `<select>` 按最宽的 option 定宽，Radix 的 trigger 只装选中那一行，换值就跳宽；把所有选项零高 `invisible` 叠进同一个 grid 单元格占住列宽
- [95-button-swallows-the-ref](./95-button-swallows-the-ref.md) — shadcn 生成的是 React 19 风格的函数组件，React 18 下 `<Button ref>` 恒为 `null`，类型全绿、生产构建无警告；已全部改成 `forwardRef`，护栏是 `tests/ui/components/forward-ref-contract.test.ts`，一次 `shadcn add` 就会写回来
- [103-anchored-overlay-paints-under-the-surface-that-opened-it](./103-anchored-overlay-paints-under-the-surface-that-opened-it.md) — 全屏设置页是 `z-[70]` 的不透明白底，锚定浮层停在生成的 `z-50`，下拉全部画在开它的页面底下；Select 开着时页面外一切 `pointer-events: none`，手指照样落在看不见的列表上，于是报成「点不动」。`elementFromPoint` 打得中而屏幕上没有 = 画的顺序不对。一条命名 z 阶梯收进 `ui/overlay.tsx` 的 `OVERLAY_Z`，锚定层排在整条阶梯之上

## 排版基线与 Tailwind

- [74-fixed-overlay-misses-shell-safe-area](./74-fixed-overlay-misses-shell-safe-area.md) — `position: fixed` 的包含块是视口，外壳按 `env(safe-area-inset-*)` 加的 padding 对它不存在，设置页被灵动岛压住、toast 落在 home indicator 上；`env()` 收进 `src/styles.css` 一组 `@utility`（`p-safe` / `pt-safe-*` / `bottom-safe-*` / `anchor-safe`），取 max(原有间距, inset) 而不是相加
- [75-split-tailwind-import-sorts-base-last](./75-split-tailwind-import-sorts-base-last.md) — 拆开 import 的 Tailwind 少了 `@layer theme, base, components, utilities;` 那行声明，layer 顺序按物理位置排，preflight 落到 utilities 后面，反过来压过每一个 utility class；验收看产物里 `@layer` 的首次出现顺序
- [76-paged-strip-rides-the-line-box-strut](./76-paged-strip-rides-the-line-box-strut.md) — 翻页模式的页带是 inline-block，竖向落点被继承来的 `line-height` 拉动；preflight 的 1.5 把整页挪了 1px（竖排模式逐字节不变）。以后动全局排版要单独复测翻页
- [77-abspos-in-a-button-starts-from-its-centre](./77-abspos-in-a-button-starts-from-its-centre.md) — 只写 `top` 不写 `left` 的绝对定位子元素放在 `<button>` 里，静态位置在按钮水平中心（Chrome 给按钮内容包了匿名居中盒），开关圆点偏了半个轨道宽；给按钮显式 `display` 或给子元素显式 `left`
- [78-tailwind-merge-only-dedupes-identical-modifier-chains](./78-tailwind-merge-only-dedupes-identical-modifier-chains.md) — `cn()` 只在修饰符串一模一样时才去重，`can-hover:hover:` 覆盖不掉 `can-hover:enabled:hover:`，两条都留下按特异性决胜；`data-[orientation=vertical]:h-full` 同理压过 `h-5`
- [79-entry-chunk-reinjects-its-own-stylesheet](./79-entry-chunk-reinjects-its-own-stylesheet.md) — Vite 入口 chunk 运行期再插一遍原始样式表，改 HTML 里的 `<link>` 指向改造过的副本无效；要整份 dist 复制后原地改 CSS
- [82-duration-200-alone-transitions-every-property](./82-duration-200-alone-transitions-every-property.md) — `duration-*` 不设 `transition-property`，初始值 `all` 让这个元素每个属性都走 200ms 过渡；量计算样式要等满动画时长，否则读到过程值
- [84-js-cannot-read-env-safe-area-inset](./84-js-cannot-read-env-safe-area-inset.md) — 自定义属性里的 `env(safe-area-inset-*)` 从 `getComputedStyle` 拿回来还是那串原文，`parseFloat` 得 NaN；要读数字得让真属性吃掉它（隐藏探针元素的 padding），只有夹取在 JS 里的浮层才需要
- [90-leading-normal-is-not-the-inherited-line-height](./90-leading-normal-is-not-the-inherited-line-height.md) — shadcn 的文本原语自带 `leading-none`，还原原来的行高要写 `leading-normal`（1.5，preflight 给 `html` 的那个），`leading-[normal]` 是字体建议行距、少 3px
- [130-an-arbitrary-font-size-brings-no-line-height](./130-an-arbitrary-font-size-brings-no-line-height.md) — `text-sm` 编出 `font-size` 加 `line-height` 两条，`text-[任意值]` 只有 `font-size`，行距悄悄退回继承值；补的那条要无单位，`leading-5` 这种 rem 值不跟着字号走

## markdown 渲染

- [136-react-18-warns-on-every-hyphenated-svg-attribute](./136-react-18-warns-on-every-hyphenated-svg-attribute.md) — React 18 把 `stroke-width` 这类连字符 SVG 属性照写进 DOM，但每个都报一次 `Invalid DOM property`，一张图刷几十条；元素树保留真名，交给 React 前驼峰化，`aria-*`/`data-*` 除外。文里的图表卡和 `SvgFigure` 已删（作废 2026-08-20，见 [40](../40-聊天里画结构图.md)），React 18 的这个行为本身仍成立，再手写 SVG 元素树按这条办
- [153-a-cjk-full-stop-keeps-bold-from-closing](./153-a-cjk-full-stop-keeps-bold-from-closing.md) — CommonMark 的 flanking 规则不让 `**` 在中文标点和汉字之间收尾，`**结论：**这样不行` 整句连星号一起显示，而模型写中文时几乎每段都这么写；加 `remark-cjk-friendly` 和 `remark-cjk-friendly-gfm-strikethrough`（后者必须排在 `remarkGfm` 之后），插件表单独一个模块以免把 lazy chunk 拖进主包
- [154-react-markdown-hands-every-override-a-node-prop](./154-react-markdown-hands-every-override-a-node-prop.md) — react-markdown v10 给每个换成组件的元素多传一个 `node`（hast 节点），`AnchorHTMLAttributes` 里没有这个字段，它跟着 `...rest` 铺到 `<a>` 上渲染成 `node="[object Object]"`；类型全绿、React 18 也不警告。签名交叉上包里的 `ExtraProps` 再把 `node` 解构出来丢掉
- [156-a-display-fence-must-be-alone-on-its-line](./156-a-display-fence-must-be-alone-on-its-line.md) — remark-math 只认独占一行的 `$$`：开头行 `$$` 后面的内容变成 `meta` 被丢掉，`\end{bmatrix}$$` 不算收尾，没收上的块把后面的正文一起吃进同一个 math 节点渲染成红色原文；模型写的多行公式全是这个形状，一处规范形式都没有。解析前逐行走一遍，把这个形状的开头行和收尾行各切一刀（`mathFences.ts`），行中间的 `$$`、单行成对的、代码里的都不动；只有被切开又等不到收尾的开头行（流式写到一半）转义成 `&#36;&#36;`

## AI 调用与上下文窗口

- [64-replayed-assistant-timestamp-without-usage](./64-replayed-assistant-timestamp-without-usage.md) — 重放的 assistant 消息缺 `timestamp` 和 `usage` 正好绕开 pi 的估算路径；单补 `timestamp` 会让 `clampMaxTokensToContext` 在每一次 AI 调用里抛 TypeError，全 app 的 AI 当场全死
- [65-pi-clamps-max-tokens-to-one-and-calls-it-done](./65-pi-clamps-max-tokens-to-one-and-calls-it-done.md) — 上下文接近窗口时 pi 把允许输出夹到 1，模型吐一个 token 就停，`done` 正常发出、没有 error；聊天里是一个字的回复，解析 JSON 的地方变成"格式错误"。pi 的估算器还是 `chars/4`，中文低估 2.5–4 倍，最该收紧时放行。发请求前自己算，见 `src/budget/`
- [66-usage-shortcut-freezes-pi-context-estimate](./66-usage-shortcut-freezes-pi-context-estimate.md) — 消息数组里一旦有带 usage 的真 assistant 消息，pi 的估算就等于那个 usage，系统提示词不再计入，压缩 usage 之前的任何东西都不改变它；重放历史里那条没 timestamp 的 assistant 消息又会把捷径整个关掉（NaN 比较），同一个调用点两套计价。判断压缩够不够只能重新量，不能拿字符估的 saving 去减
- [131-pi-cache-retention-env-never-reaches-the-webview](./131-pi-cache-retention-env-never-reaches-the-webview.md) — `PI_CACHE_RETENTION=long` 在 dev 和打包版都读不到：webview 里没有 `process`，Vite build 又把 `process.env` 换成 `{}`，pi 每次都落回 5 分钟保留期。要换只能在发送路径上传 `cacheRetention`，并把同一个值传给埋点

## 开发环境

- [14-dev-build-oomd-session-kill](./14-dev-build-oomd-session-kill.md) — 全量 Rust 编译触发 systemd-oomd 杀整个桌面会话；日常用 `bun run dev:capped`
- [55-worktree-dev-server-serves-stale-modules](./55-worktree-dev-server-serves-stale-modules.md) — worktree 在 `.claude/` 下，正好被 Vite 的 watch ignore 命中，dev server 看不见自己的改动；每次改完要重启
- [118-the-simulator-is-the-same-webkit-with-a-different-finger](./118-the-simulator-is-the-same-webkit-with-a-different-finger.md) — iPad 模拟器跑的是真 WKWebView + 真 PDFium + 经 HID 注入的真触摸，橡皮筋、笔手路由、双指缩放都能量出数；但没有笔（`pointerType` 恒为 touch）、没有接触面积（恒 40×40）、idb 一次只有一根手指（双指只能走 XCUITest 的 pinch，三指以上无解）。跑法在 `scripts/ios-sim.sh`
- [119-mock-module-rewrites-the-registry-for-the-whole-worker](./119-mock-module-rewrites-the-registry-for-the-whole-worker.md) — `mock.module` 改的是整个进程的模块表且不回滚，两个测试文件加载顺序一前一后就互相污染（只跑了 33 个用例里的 7 个）；归因是错的：`bun test` 全场一个进程没有 worker，胜负由加载顺序决定（坑 120）。被测模块把依赖当参数收，别换模块表
- [120-a-registered-dom-outlives-the-file-that-registered-it](./120-a-registered-dom-outlives-the-file-that-registered-it.md) — `bun test` 全场一个进程，注册一次 DOM 之后每个文件都有 `window`，`isTauri()`/settings 退出 flush/debounced-writer/overlay 全被推到浏览器分支；窗口按文件搭按文件拆（`tests/support/dom.ts` 的 `useDom()`），拆在 `afterAll`，要趁 DOM 还在做的事放 `afterEach`；跑过一次真 DOM 全场一次性慢 0.11s，不随文件数涨
- [121-react-dom-decides-once-whether-it-is-in-a-browser](./121-react-dom-decides-once-whether-it-is-in-a-browser.md) — react-dom 在模块求值时算一次 `canUseDOM`，晚了就永久不监听 `input`，受控 input 的 `onChange` 静默不响；bun 先求值 node_modules 再求值本地依赖，调 import 顺序没用，只能让 `useDom()` 注册完窗口再动态 import 并返回 `@testing-library/react`
- [122-spyon-swaps-an-esm-export-and-puts-it-back](./122-spyon-swaps-an-esm-export-and-puts-it-back.md) — bun 的 ESM 命名空间可写：`spyOn(ns, "导出名")` 导入方看得见，`mockRestore()` 能还原，命名导出/默认导出/再导出链都成立；这是 119 之外替换模块导出的另一条路，还原写在 finally 里
- [135-headless-chrome-window-size-is-not-the-viewport](./135-headless-chrome-window-size-is-not-the-viewport.md) — 无头截图核对渲染时 `--window-size` 给的是外窗，视口矮 87px、宽度还有 500px 下限，图底部被裁掉一截还容易误判成布局出界；窗口开大 + `--force-device-scale-factor=1` + 零边距包装页
- [123-vite-serves-node-modules-over-http](./123-vite-serves-node-modules-over-http.md) — `node_modules` 在 `server.fs.allow` 默认的根下面，dev server 照样按 HTTP 发出去（还给套一层明文 sourcemap）；秘密要写在服务的树之外，`.gitignore` 和 0600 都拦不住
- [124-fs-deny-replaces-the-defaults](./124-fs-deny-replaces-the-defaults.md) — vite 解析 `server.fs?.deny || ['.env', '.env.*', '*.{crt,pem}']`，插件从 `config()` 返回一份 deny 就把这三条默认值整个顶掉，dev server 当场 200 发出 `.env` 正文外加明文 sourcemap；要加只能在 `configResolved` 里往已解析的数组 push。凡是 `x || 默认值` 解析的 vite 字段都是提供即替换
- [134-dropthreadcache-reloads-instead-of-dropping](./134-dropthreadcache-reloads-instead-of-dropping.md) — `dropThreadCache` 不删缓存条目，它从文件重读一遍再合进去；`beforeEach` 里调它不隔离用例，同一个 `threadId` 会继承上一个用例追加的整段历史，用例之间要换 id
- [142-a-worktree-vite-writes-the-main-checkouts-dep-cache](./142-a-worktree-vite-writes-the-main-checkouts-dep-cache.md) — worktree 的 `node_modules` 是主 checkout 的软链，vite 默认把依赖预构建缓存写进 `node_modules/.vite`，打断用户的 `tauri dev`（`--force` 更是直接清掉）；实验用私有 config 覆盖 `cacheDir` 和 `watch.ignored`，每轮 curl 确认吐的是新代码
- [144-the-layering-test-reads-imports-inside-comments](./144-the-layering-test-reads-imports-inside-comments.md) — `tests/layering.test.ts` 不剥注释，注释里写成 `from "../lecture"` 形式的一行照样落成一条目录依赖边，造出一个代码里不存在的环；注释里指别的目录写裸路径，别写 import 语句形式
- [155-cargo-never-hears-that-the-icon-changed](./155-cargo-never-hears-that-the-icon-changed.md) — 图标是编译期嵌进二进制的，`tauri_build::build()` 的 rerun-if-changed 名单里没有 `src-tauri/icons/`，`generate_context!` 又只 `include_bytes!` 一份 `OUT_DIR` 里按校验和命名的副本；换了图片 cargo 认为没东西变，dev 起来还是旧图标。`touch src-tauri/tauri.conf.json` 再起。桌面用的是 `bundle.icon` 里第一个 `.png`（`icons/32x32.png`），不是 `icon.png`
- [151-a-dev-build-registers-the-dev-binary-for-login](./151-a-dev-build-registers-the-dev-binary-for-login.md) — dev 下打开开机启动写进登录项的是 `target/debug` 那个二进制，它的 devUrl 指着 vite dev server，开机起来只有一张 connection refused 错误页；手删还会被下次启动的对齐写回去。dev 构建里开机启动整个当作不可用，启动时的对齐无条件 `disable()`，`device.json` 里的意愿留着等打包版
- [169-a-nul-byte-makes-the-whole-file-invisible-to-grep](./169-a-nul-byte-makes-the-whole-file-invisible-to-grep.md) — 源码里写死的 0x00 字节（不是 `\0` 转义）让整个文件对 grep 变二进制：GNU grep 的提示走 stderr、退出码还是 0，会话里套了 `-I` 的 ugrep 连提示都没有，于是「grep 扫不到这个文件」和「这个符号没人用」长得一模一样，一次审计差点删掉一个还在被 import 的模块。改回 `\0` 转义，`tests/source-is-text.test.ts` 扫 `src`/`tests`/`scripts` 的每个 `.ts`/`.tsx`
- [171-a-leaked-spy-fails-someone-elses-file](./171-a-leaked-spy-fails-someone-elses-file.md) — 装在模块顶层的 `spyOn` 装完就一直是假的，后面每个文件都看得见，`afterAll` 里的还原在文件顶层抛错时不跑；随机文件顺序下挂的全是没装 spy 的文件（seed 23 62 fail）。`bunfig.toml` 的 `[test] preload` 挂 `tests/support/preload.ts` 做全局 `beforeEach(mock.restore())`，spy 一律装在 `beforeEach` 或用例体里——装模块顶层会从第二个用例起静默失效，拿到真实现
- [172-bunfig-is-found-from-the-working-directory](./172-bunfig-is-found-from-the-working-directory.md) — bun 按当前工作目录找 `bunfig.toml`，不往上找项目根；`cd tests && bun test reading/` 于是没有 preload，坑 171 那条全局 `beforeEach(mock.restore())` 整个不装，模块顶层的 spy 照旧漏给下一个文件，而且一句提示都没有。`tests/support/gate.ts` 一个惰性 flag 由 preload 点亮，`tests/preload-gate.test.ts` 断言它为真并再用两个用例断言还原真的发生；只在选中了这个文件的运行里生效
- [173-a-leaked-window-makes-a-conditional-installer-skip-its-job](./173-a-leaked-window-makes-a-conditional-installer-skip-its-job.md) — 一个 `useDom()` 文件在模块作用域抛错就把 happy-dom 的 window 漏给后面，`tests/support/dom-parser.ts` 的 `if (typeof DOMParser === "undefined")` 于是什么也不装，再往后谁的 `afterAll` 卸掉那个 window，`unregister()` 就按 register 时存的 null 把 `DOMParser` delete 掉，此后 `sanitizeArticleHtml` 对任何输入都返回 `""`；默认顺序和单文件单跑都是绿的。改成 preload 里无条件装（getter 惰性 require jsdom），`dom-parser.ts` 删掉；`DOMParser` 不像 window 那样是分支判据，所以不违反坑 120

## 历史（zotero/reader 引擎时代）

引擎已换成 EmbedPDF，这几篇留着是因为还有东西没随引擎一起死。每篇开头一行写明哪部分还成立。

- [02-math-sumprecise-polyfill](./02-math-sumprecise-polyfill.md) — mobile pdf.js 裸调 Math.sumPrecise；WebKitGTK 落后于新内建这条仍在，现在体现为加载 pdf.js 前要补 `Promise.withResolvers`
- [04-programmatic-select-no-popup](./04-programmatic-select-no-popup.md) — 程序化选中不弹浮窗；EmbedPDF 下结论反过来了，弹窗照开
- [07-image-annotation-base64](./07-image-annotation-base64.md) — image 标注内联截图导致 JSON 膨胀；区域框选已移除，但"大字段拆出 JSON 单独落盘"被 threads 沿用
- [10-cross-realm-uint8array](./10-cross-realm-uint8array.md) — iframe 跨 realm 的 Uint8Array instanceof；app 里的 iframe 回来了（deck 的 srcdoc，见坑 152），但走 postMessage 不传字节，撞不上
- [11-engine-calls-before-init](./11-engine-calls-before-init.md) — 引擎方法必须等就绪信号之后调；PDFViewerApplication 没了，规矩还在
