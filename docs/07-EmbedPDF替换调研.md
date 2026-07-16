# EmbedPDF 替换调研

2026-07-16 调研定稿。背景:zotero/reader 的 AGPL 与 App Store 冲突(见 `06-iOS发布路线.md`),issue zotero/reader#231 已发出但成败未知;EmbedPDF 是 MIT,还顺带解除对 CDS 授权的长期依赖、不挡商业化。决定不等 CDS 回复,直接探索替换。只考虑 PDF,不管 EPUB/snapshot。

## 结论

有条件可行,倾向于做。许可证是硬收益:EmbedPDF core 与全部标准插件 MIT,PDFium 走 Apache-2.0(repo LICENSE + LICENSE.pdfium: https://github.com/embedpdf/embed-pdf-viewer)。插件矩阵覆盖我们对引擎的全部真实依赖,headless/vanilla 接入成熟,支持从内存字节加载、host 独立持久化、批注挂任意自定义字段。

代价在适配层形态变了。现在是"在 iframe 里调一个 window.createView,拿回封装好的 view 实例";换 EmbedPDF 后要自己装配 PdfiumEngine + PDFCore + 约十二个 plugin,并把 zotero 那套聚合好的回调(onChangeViewStats、onSetAnnotationPopup 的视口 rect 等)从各插件 state 里自己拼出来。不是难,是工作量前移。另有五处必须 spike 实测才能定(坐标系原点、位置精确还原、程序化滚动到标注、iOS/WKWebView、highlight 取原文)。

一个前置澄清,直接影响工作量:我们壳对引擎的真实依赖面比 docs/04 小得多。outline、全文搜索、页码、缩略图全部是壳自己用独立 pdfjs-dist 4.10.38 抽的(src/fulltext/、src/components/OutlineView.tsx),引擎的 onSetOutline/onSetPageLabels/onSetThumbnails/onFindResult/onSetSelectionPopup 在 src/reader.ts 的 CALLBACK_DEFAULTS 里全是 noop,App.tsx 的 createPdfView 也只传了 7 个回调。换引擎不碰这块——替换成本最大的省项。

## 契约映射表(我们 App.tsx 真接的,不是 docs/04 的全部)

| 我们的契约 | 用途 | EmbedPDF 对等物 | 缺口 |
|---|---|---|---|
| createView({type,data.buf}) | 从字节渲染 | engine.openDocumentBuffer({id, content: ArrayBuffer\|Uint8Array}) | 无 |
| onInitialized | 就绪信号 | core.on('document:loaded') / 插件 ready | 无 |
| onSaveAnnotations(anns) | 创建/修改 | annotationApi.onAnnotationEvent type=create/update | 无 |
| onDeleteAnnotations(ids) | 删除 | 同上 type=delete | 无 |
| onSelectAnnotations(ids)(必须回喂,pitfall05) | 点标注选中 | selectAnnotation/getSelectedAnnotation,无自环坑 | 无(坑消失) |
| onSetAnnotationPopup({rect,annotation}) rect 是视口坐标 | 点标注弹浮窗 | selection plugin selectionMenu 给 rect+placement;点已有标注要从选中事件+标注 rect 自算视口坐标 | 中:视口 rect 自算 |
| onChangeViewState | 阅读位置持久化 | scroll/zoom 插件 state+initial 配置 | 中,需验证精确还原 |
| onChangeViewStats | 导航/缩放 can* 位 | 从 zoom/scroll/navigation 插件 state 自己组装 | 低-中:要自拼 |
| view.setTool(tool) | 切工具 | annotationApi.setActiveTool + plugin-interaction-manager | 无 |
| view.setAnnotations([obj]) upsert 不回触 save | host 改色/comment | updateAnnotation(pageIndex,id,patch) | 无 |
| view.unsetAnnotations([ids]) | host 删 | deleteAnnotation(pageIndex,id) | 无 |
| view.selectAnnotations([id]) | 程序化选中 | selectAnnotation(...) | 无 |
| view.navigate({pageIndex}) | 跳页 | plugin-scroll/plugin-navigation scrollToPage | 无 |
| view.navigate({annotationID}) | 滚到标注并选中 | selectAnnotation 有,scroll-to-annotation 未文档化 | 中,需验证 |
| view.zoomIn/Out/zoomReset | 缩放 | plugin-zoom(fit-width/fit-page/自定义 scale) | 无(还能做 zotero 做不到的 100%,解掉 pitfall17) |
| view.setSpreadMode | 单双页 | plugin-spread | 无 |
| 自定义字段 aiThreadId round-trip | AI 陪读核心 | PdfAnnotationObjectBase.custom("any custom JSON-serializable data") | 无,一等公民 |
| annotation.text 选中原文 | TraceList+AI context | highlight 是否存原文未确认(大概率不存);selection plugin getSelectedText() 可建注时抓 | 中:自抓塞 custom |
| ink 压感 | 手写 north-star | PdfInkAnnoObject{inkList, strokeWidth 单值},无 pressure | 平手:zotero 也没有,north-star 已列自己做 |

选择几何(onSetSelectionPopup,当前 noop,将来划词浮窗才用):selection plugin onEndSelection + getFormattedSelection() 给 boundingBox 和 per-line rects,比现在更直接。

来源:annotation plugin https://www.embedpdf.com/docs/react/headless/plugins/plugin-annotation ;selection plugin https://www.embedpdf.com/docs/react/headless/plugins/plugin-selection ;annotation-models https://www.embedpdf.com/docs/engines/annotations/annotation-models ;openDocumentBuffer https://www.embedpdf.com/docs/engines/document-lifecycle/open-document-buffer

## 批注数据迁移方案

现有落盘是 zotero 格式 JSON(pageIndex + position.rects PDF pt + sortIndex + text + aiThreadId + type/color/comment/tags),host 自己按文件存(src/annotations.ts)。存储层结构不变,只换对象 schema,写一个双向转换器:

- 形状:zotero position.rects [[l,t,r,b]…] ↔ EmbedPDF segmentRects [{origin:{x,y},size:{w,h}}](highlight/underline)。
- 坐标:EmbedPDF Rect 是 top-left 原点(从 geometry.ts 的 rotateRect 推断,未逐字验证),zotero 是 PDF pt bottom-left,需 Y 翻转,要页高(pdfium 可查 page size)。纯函数,好写好测。
- 字段:color/opacity 直接对应;comment→contents;text/aiThreadId/tags/旧 zotero id 塞进 custom(透传,round-trip 已确认可存)。
- id:zotero 是 8 位 key,EmbedPDF 用 uuidv4,新建用 uuid,旧 id 留 custom 供追溯。
- sortIndex:EmbedPDF 无对等物。TraceList 现在靠它排文档序(TraceList.tsx),改成壳侧按 pageIndex+rect.origin.y 自算。
- 一次性迁移脚本:读老 annotations-<hash>.json → 转 → 存新格式。ink 无历史数据,highlight/underline 量小,风险低。

## 风险清单(按严重度)

1. iOS/WKWebView/Tauri 实机未验证。维护者正招移动端开发做多平台 SDK,但无 Tauri+WKWebView 公开成功案例。整个上架路线押在这上面。必须最先 spike。
2. WebKitGTK 手写/拖选延迟(pitfall12)会不会在新引擎重现。zotero 是 pdf.js DOM 渲染,EmbedPDF 是 PDFium WASM 渲染,合成路径不同,延迟表现未知,只能实测。
3. 适配层工作量前移。自己装配 core+约十二个插件并聚合状态,比调一个 createView 重。是成本不是风险,但会拖慢 M-iPad。
4. 坐标系原点、viewState 精确还原(top/left/scale)、程序化 scroll-to-annotation:三项都"应该能做"但未文档化/未验证,任一不成立要绕。
5. highlight 不存原文(未确认)。若确认不存,建注时必须用 selection plugin 抓文本,时序要对。
6. 项目健康度:两人团队(Bob Singor + 一名招聘的移动开发),靠 GitHub Sponsors 目标 $30k/月全职维护(https://github.com/sponsors/embedpdf ,https://pdfa.org/member/embedpdf/ )。节奏活跃(42 releases,v2.14.4/2026-06,1865 commits,4.3k stars),但 breaking change 频率未知,且有"多平台 SDK 商业化"动机,留意将来某些能力 open-core 化。当前 core+全部标准插件 MIT,无付费墙。
7. WASM 体积:pdfium.wasm 4.63 MB 未压缩(jsdelivr 实测 4,633,788 B),CDN brotli 后约 2 MB。默认从 jsDelivr fetch,但 init({wasmBinary}) 接收字节,npm 包内含 dist/pdfium.wasm,可本地自托管 → 离线可构建(对比 pitfall08 的 reader 构建期联网,反而是改善)。

## spike 验证清单(按优先级)

1. iOS WKWebView 真机:能渲染、能批注、能手写、WASM 能加载。卡在 Apple 开发者账号,和 M-iPad 同一前置。
2. Tauri+WebKitGTK(Linux 桌面):装配 core+plugins 跑通渲染+高亮+ink,量拖选/手写延迟对比 pitfall12。
3. 坐标系原点与 Y 翻转:造已知 rect 的 highlight,导出看 segmentRects 数值,确认 top-left+页高翻转公式。
4. viewState 还原:保存 scale/scrollTop 再重开,验证精确回到位(不只回到页)。
5. 程序化 scroll-to-annotation:selectAnnotation 能否附带滚动,不能就自己 scrollToPage+偏移。
6. highlight 建注取原文:确认 highlight 对象是否带文本;不带则验证 getSelectedText() 在 onEndSelection 后建注时能拿到对应文本。
7. 自定义字段 round-trip:custom.aiThreadId 走 export→存→import→update 全程不丢。
8. 从内存字节加载:openDocumentBuffer 直接吃 readFile 的 Uint8Array,无需落临时文件。

## 粗略工作量估计

- 适配层重写(src/reader.ts 等价物:pdfium+core+plugin 装配、openDocumentBuffer、封装 setTool/CRUD/navigate/zoom/spread、把 viewStats/viewState 从插件 state 聚合、批注事件桥):6-10 人日。重点在状态聚合和插件装配,不在单个 API。
- 坐标/schema 转换器 + 一次性数据迁移脚本 + 单测:2-4 人日。纯函数,可 headless 测(沿用 src/fulltext 的 pure-function 测法)。
- UI 接线(App.tsx/PenToolbar/TraceList/AnnotationPopup 改用新桥,浮窗锚点改用 selection rect,sortIndex 换自算文档序;OutlineView 和 src/fulltext 壳侧 pdfjs 原样保留不动):3-5 人日。
- spike(前 8 项)+ iOS/WebKitGTK 复测:另计,是风险闸门不是线性工时。

合计约 11-19 人日工程,外加两处必须真机才能关的闸门(iOS、WebKitGTK 延迟)。顺序:先做 spike 2(桌面闸门)与 3-8(契约存疑项),全绿再动适配层;iOS 闸门等开发者账号。

未验证项汇总(推断或文档缺失,spike 已逐条覆盖):坐标系 top-left 原点、highlight 不存原文、程序化 scroll-to-annotation、viewState 精确还原、iOS/WKWebView 行为。

## WASM 与重计算的边界(2026-07-16 讨论补充)

EmbedPDF 的 WASM 是 PDFium(C++)编译产物,渲染是黑盒调用,我们不写渲染代码。将来的重计算(如向量检索)放 Tauri Rust 侧走 command,不放 webview 内 WASM:WKWebView 有页面进程内存上限,PDFium 堆已占一份。用 Rust 写保留"将来编译成 WASM 上纯网页版"的退路。
