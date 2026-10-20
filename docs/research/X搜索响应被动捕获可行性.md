# X 搜索响应被动捕获可行性

2026-10-20。问题：能不能在我们自己的隐藏 webview 里，旁听 X 搜索页本身收到的 JSON 响应（`SearchTimeline` 等），拿到长帖全文（`note_tweet`）、展开后的外链、引用帖、计数、X Article，而不发任何额外请求、不改请求、不改节奏、不被 X 的脚本轻易认出。起因是坑 657：搜索页每条只显示约 275 字，多数帖子的链接在截掉的部分里，现在只能逐条开永久链接页补。

方法：只读本仓代码、Cargo.lock 和依赖源码；实验只在本机自己起的 HTTP 服务和手写的、形状仿照公开 GraphQL 字段名的 JSON 上做，引擎用本机 WebKit2 4.1（2.52.6，就是 wry 在 Linux 上用的那个），xvfb 无窗口。全程没访问 x.com、没碰 X 的任何接口、没登录。twitter-web-exporter（MIT）只读了它的字段名和做法，没抄代码。

## 结论

1. 技术上可行，且满足硬规则。钩子只读页面自己已经发出的请求的响应体，不发请求、不改请求、不改节奏，是严格的只读。实验在真 WebKit 引擎上证明：长帖全文、展开外链、引用帖、计数都能从被动捕获的响应体里拿到，页面行为与不挂钩子时逐字节一致。
2. 可移植的唯一办法是在页面脚本之前注入 JS 包住 `fetch` 和 `XMLHttpRequest`。应用层直接读响应体的原生路径在我们实际用的栈上都不成立：WKWebView 没有这种 API；WebKitGTK 的 `WebKitWebResource` 要新写 FFI 且对 XHR/fetch 关联和流式不可靠；WebView2 的 `WebResourceResponseReceived` 要新写 Rust，而且 Windows 的 browse 路径现在本就是 `unsupported`；Android 的 `shouldInterceptRequest` 读不到响应体，要读只能自己重发一次（违反「不加请求」）。
3. 注入这条路我们现有的包装够得着：`build_window`（`src-tauri/src/webview_fetch/mod.rs`）用的 `WebviewWindowBuilder` 有 `initialization_script`，wry 把它作为 document-start 的用户脚本注入页面的主世界，Tauri 自己已经这样注入好几段。只要加一次 builder 调用并限定到 X 的 browse 会话，不需要新 FFI。
4. 能不能不被发现：对付幼稚检查（`fetch.toString()`、`Function.prototype.toString.call(fetch)`、按名字扫全局）可以做到。对付认真的检查做不到——拿一个干净 iframe 的原始 `Function.prototype.toString` 来比，必然露馅。X 的 web 脚本是否真的这么查，没有证据，属猜测。
5. 建议做，成本中（M）。但「主号绝不能被封」是硬约束，是否接受「在自己浏览器里被动旁听」这点残余风险由项目发起人定；这正是 88 开放问题 1 没定的那条。DOM 解析作为交叉校验和降级一直保留。

## 1. 各平台的注入与观测路径

browse 会话只在桌面编译：`HAS_DOM_BRIDGE = cfg!(any(linux, macos))`，Windows / iOS / Android 一律返回 `unsupported`。版本（Cargo.lock）：tauri 2.11.5、tauri-runtime-wry 2.11.4、wry 0.55.1、webkit2gtk 绑定 2.0.2（本机引擎 2.52.6）、objc2-web-kit 0.3.2、webview2-com 0.38.2。

页面脚本之前注入（我们要的那半）：

| 平台 | 机制 | 世界 | 我们够得着吗 |
|---|---|---|---|
| Linux WebKitGTK | wry `UserScript::new(js, 帧, InjectionTime::Start, &[], &[])`，经 `UserContentManager.add_script`（wry `src/webkitgtk/mod.rs:721`） | 页面主世界（能替换页面的 `fetch`，实验证实） | 够得着：`WebviewWindowBuilder.initialization_script` 一次调用 |
| macOS WKWebView | wry `WKUserScript initWithSource:injectionTime:AtDocumentStart forMainFrameOnly:`（三参，`src/wkwebview/mod.rs:780`） | 页面内容世界（非隔离世界） | 同上，同一条 Tauri API |
| Windows WebView2 | `AddScriptToExecuteOnDocumentCreated` | 页面世界 | browse 现为 `unsupported`，不涉及 |
| iOS WKWebView | 同 macOS | 同 macOS | X 取材只在桌面跑（88 硬规则 5），不涉及 |
| Android WebView | `WebViewCompat.addDocumentStartJavaScript` | 页面世界 | 同上，不涉及 |

隔离世界（isolated / `WKContentWorld`）注入不行：那样钩子看不见也替换不了页面的 `fetch`，捕获无从谈起。必须在主世界，这也正是钩子原理上可被同世界的页面脚本察觉的原因。

应用层直接读响应体（想绕过改 JS 的那半）：

| 平台 | 原生接口 | 能读响应体吗 | 代价 |
|---|---|---|---|
| WebKitGTK | `resource-load-started` → `WebKitWebResource`（`get_data`） | 理论上能拿主资源数据，但对页面发起的 XHR/fetch 的关联、流式、时机都不可靠 | 新写 FFI（`with_webview` + GObject 信号），收益不稳 |
| WKWebView | 无公开 API（`WKURLSchemeHandler` 只管自定义 scheme） | 不能 | 只能改 JS |
| WebView2 | `WebResourceResponseReceived` 能拿响应体 | 能 | 新写 Rust；且 Windows browse 本就 unsupported |
| Android | `shouldInterceptRequest` | 不能（它是「替你提供响应」，要读得自己重发） | 重发 = 加请求，违反硬规则 |

所以：跨平台一致、不加请求、现有包装够得着的，只有主世界的 document-start JS 注入。

## 2. 若只能打补丁，怎么难被发现，X 能查什么

做得到（实验证实对这些探针返回原生表现）：

- `window.fetch.toString()` 伪装成 `function fetch() { [native code] }`：给包装函数定义自己的 `toString`，并补 `name`、`length`。
- `Function.prototype.toString.call(fetch)`：替换 `Function.prototype.toString`，对我们的包装用 WeakMap 查原生文本，其余透传。
- 不留痕迹的全局：捕获物放在 `Symbol.for()` 键下、非枚举，`Object.keys(window)` / for-in 扫不到。
- 不改 DOM、不写 console、不改页面可观察的时序（用 `clone()` 给钩子单独一份，页面那份不受影响）。

做不到 / 一定露馅（已验证会被抓）：

- 干净 iframe 比对：`iframe.contentWindow.Function.prototype.toString` 是未被动过的原件，拿它作用在我们的 `fetch` 上，返回包装的真实源码而非 `[native code]`。
- 身份比对：`Function.prototype.toString !== 干净 iframe 的那一个`，直接暴露原型被换过。
- `Object.getOwnPropertySymbols(window)` 能列出我们的 Symbol 存储键。
- 若用命名的 message handler 交付（`window.webkit.messageHandlers.<名字>`），页面能枚举到这个名字。

已知 vs 猜测：以上检测手段本身是确定的（实验里逐条验了）。X 的线上脚本是否真的跑这类探针、尤其是干净 iframe 比对 `fetch` 完整性，没有任何公开证据，属猜测。twitter-web-exporter 的维护者自述「像人手工复制，封号不太可能」，是判断不是保证。稳妥的做法是把可见表面压到最小（不注册命名 handler、只用 Symbol + 非枚举、交付走下面说的 `evaluate` 读取），并接受「认真查一定能查出来」这个事实，由发起人决定要不要在主号上冒这点险。

## 3. 本地实验与结果

引擎 WebKit2 4.1（2.52.6），经 `UserScript` 的 `InjectionTime.START` 注入（与 wry 注入初始化脚本同一个原语），xvfb 无窗口。页面用 `fetch`、`XMLHttpRequest`（`responseType=json`）、`ReadableStream`（`getReader()` 自己读流）各取一次，另有 3 MB 大响应、一条 pushState 之后的再取、一条不匹配的无关请求；页面把自己解析到的东西记进 `window.__pageSaw`。分别在挂钩子和不挂钩子两种情况下跑同一套。脚手架留在 scratchpad（`exp/`：`site/api.py`、`site/page.html`、`hook.js`、`detect.js`、`harness.py`），没进仓库——它依赖 python-gi 的 WebKit2 绑定，仓库里真实的 X 探测走 `scripts/x-search-probe.ts` 和真二进制。

证到的：

- 捕获成功：5 条 `SearchTimeline` 响应体全拿到（`fetch`、XHR、流式、3 MB 大体、pushState 之后那条），无关请求正确地没被捕获。从捕获体里解出长帖 `note_tweet` 全文 4000 字（页面自身的 `full_text` 只有 275 字加省略号）、展开后的 `expanded_url`、`favorite_count`。
- 页面行为一致：挂与不挂钩子，`window.__pageSaw` 都是 6 条调用全部完成，逐条一致；页面自己用 `getReader()` 读流、读 3 MB 大体都照常，`clone()` 给钩子的副本不影响页面那份。
- 确在页面脚本之前：钩子安装时 `document.readyState` 为 `loading`。
- 交回我们这侧两条路都通：非枚举的 Symbol 全局（由 `evaluate` 读取，等同 browse.rs 的 look 脚本读页面）和脚本消息（wry IPC 的等价物）都收齐 5 条。
- 大体和流式都处理正确：3 MB 整体捕获（长度 3152493）；chunked 流式响应页面 `getReader` 读完的同时钩子经 `clone()` 也拿到完整体。
- SPA 内导航后仍然有效：pushState 改地址后那条照样捕获。

检测探针结果（挂钩子时）：

| 探针 | 抓到钩子？ |
|---|---|
| `fetch.toString()` 看 `[native code]` | 没抓到 |
| `Function.prototype.toString.call(fetch)` | 没抓到 |
| `XMLHttpRequest.prototype.open` 源码 | 没抓到 |
| 枚举全局找可疑名字 | 没抓到 |
| 干净 iframe 的原始 toString 作用于 `fetch` | 抓到 |
| `Function.prototype.toString` 身份 vs 干净 iframe | 抓到 |
| 被换的 toString 自身源码（用原件查） | 抓到 |
| `Object.getOwnPropertySymbols(window)` | 抓到（能看到 Symbol 存储键） |
| 命名 message handler 存在性 | 抓到（若用了命名 handler） |

## 4. 设计

接入点（都在 X 取材这条线，`src/info/x/`、`src/info/topic-search/x-reader.ts`）：

- 注入：`build_window` 加一个参数（经 `Chrome` 或新字段）表示「这是 X 的 browse 会话，带搜索捕获钩子」，只给 X 会话加 `initialization_script`，彭博全文和登录窗不加。钩子是一段固定 JS，放 `src/info/x/search-capture.ts` 作字符串常量（和 `SEARCH_PAGE_SCRIPT`、`PERMALINK_SCRIPT` 并列），Rust 侧从前端传入或内联。
- 捕获与交回：钩子把匹配 `/graphql/<id>/SearchTimeline` 的响应体解析后按 id 存进页面里一个非枚举 Symbol 下的 map（存解好的字段，不存整段 JSON）。`x-reader.ts` 在每屏读完、滚动之间用现有的 `session.evaluate(DRAIN_SCRIPT)` 取走并清空（不加新 capability 方法）。不注册命名 message handler，省掉那个暴露面。
- 数据形状（每条捕获的帖子）：`id`、`author{handle,name}`、`fullText`（`note_tweet` 全文，没有就 `legacy.full_text` 按 `display_text_range` 截取）、`expandedUrls[]`（`legacy.entities.urls[].expanded_url`，去 X 自己和本站导航）、`quoted{id,author,fullText}`（`quoted_status_result`）、`counts{replies,reposts,likes,quotes,bookmarks,views}`、`card`、`isArticle`、`postedAt`（仍由程序从 id 解 snowflake，不信响应里的时间）。形状对齐现有 `XSearchPost` / `XSyndicatedPost`，解析器写成纯 `.ts` 配单测。
- 降级与交叉校验：DOM 解析（`SEARCH_PAGE_SCRIPT` → `parseSearchRead`）照常跑，是主路径。某条帖子在捕获 map 里命中就用捕获的全文和链接覆盖 DOM 读到的截断版；没命中就用 DOM 那份，必要时再按坑 657 开永久链接页。两者都在时，程序可比对 id、作者、计数是否一致，不一致记进进度文件当信号。这样钩子失效（X 改了响应形状、或我们主动关掉）时，行为退回今天的样子，不中断。
- 预算与永久链接页次数：长帖全文和展开外链从捕获体直接得到，截断帖开永久链接页（88 节奏表里第一次 12 次、每晚 40 次，日额度 80）大幅下降，趋近于只剩「捕获里没有的」情形——主要是 X Article 正文（`SearchTimeline` 里只有标题和预览，不含正文）和响应里未带的引用帖。钩子不改搜索页本身的请求数和滚动节奏：搜索页的无限滚动照人速滚，SearchTimeline 是它自己随滚动发的，我们只读响应体。
- 隐私：只留这次 run 要用的字段，解析后即丢整段响应体（3 MB 的大体不落盘）；`x-read.json` 只写抽出的字段，和今天一致。

不碰 X 的测试：手写 fixture，形状照公开 GraphQL 字段名（`note_tweet.note_tweet_results.result.text`、`legacy.entities.urls[].expanded_url`、`quoted_status_result`、`legacy` 下的各计数），就是本次实验 `site/api.py` 里那套；解析器对 fixture 跑单测，不联网。字段名读自 twitter-web-exporter 源码，未抄代码。

## 5. 建议、成本、风险、开放问题

建议做。成本中（M）：一段注入 JS、一个解析器加单测、`build_window` 加一个会话标志、`x-reader.ts` 里一处 drain 并入。不需要新 FFI，不需要动 WKWebView/WebView2 的原生层。

风险：

- 封号 / 被发现（最重）：钩子在主世界，认真的完整性检查一定能查出（第 2 节）。X 是否真查，无证据。主号绝不能被封是硬约束，这点残余风险要发起人拍板。缓解：最小可见面、不用命名 handler、随时可关并退回 DOM 路径。
- X 改响应形状：`SearchTimeline` 的字段路径会随版本变。解析器必须「取不到就当没有」，自动退回 DOM，不抛错、不中断 run。
- ToS：X 条款不鼓励程序化读取；我们的立场是只读用户自己浏览器收到的内容、人速、只用主号自己的登录态，与账号池/指纹伪装那一族不同，但仍是条款的灰区。

开放问题：

1. 被动旁听算不算 88 硬规则 2「只读、开页面是导航、不点按钮」之内？不发请求、只读页面自己收到的，但比读 DOM 更程序化。这是发起人要定的那条（88 开放问题 1）。
2. X Article 全文不在 `SearchTimeline` 响应里，仍要开永久链接页；要不要同样旁听 Article 页自己的请求，另议。
3. 要不要彻底不用 message handler、只用 `evaluate` 读取（少一个暴露面，代价是交回时机绑在 drain 节奏上）。
4. 捕获和 DOM 不一致时，信哪个、记不记成停手信号。
