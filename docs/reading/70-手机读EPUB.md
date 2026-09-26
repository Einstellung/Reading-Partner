# 手机读 EPUB

2026-09-16 定。取代 docs/22 的「手机上只做 info，不做书」和「划线永久不做」两条；docs/22 其余照旧。

## 定下的

手机上读 EPUB，不读 PDF。iPad 和 PC 保持 docs/64 的纸页，一行不动。

- docs/22 不做书的理由是 PDFium WASM。EPUB 绕开了它，但 docs/64 的 Letter 纸在 393pt 宽的屏上 fit-width 是 0.48 倍、正文约 7.7pt，纸页在手机上守不住。手机用自己的重排视图。
- PDF 不给手机看。书架上 PDF 的封面照常渲染，点了出一条提示，不打开。
- AI 的闸：笔架上的 AI pen 画出来但不可按，带一句原因。不隐藏：手机是 reading 的一种形态，规矩要在界面上读得出来。2026-09-25 起顶栏的 Learn this book with AI 可按，进的是和 iPad 同一堂课（[77](./77-手机EPUB课堂.md)）；AI pen 仍置灰，原因改成 `The AI pen is not on the phone yet — Learn this book with AI is in the top bar`。
- 长按划线。手指按住不动约半秒起一条高亮，拖动延长，抬手落标注。也可以在笔架上选 Highlight 再拖，两条路落的是同一种标注。点已有标注弹出删除。墨迹不做：手机没有页。
- 手机上只有 Outline 一个侧栏内容，做成 sheet（Radix dialog 贴底边）。条目按分页表的块号跳，不按 href——`outlineFor` 交回的就是块号。没有 Marks 列表、备课面板、痕迹列表。
- 笔架上不画导航锁：手机没有页可以锁住，一根手指只有滚动一个意思。那一格改成 Aa，打开显示设置。`PenToolbar` 加 `omit` 省掉某个工具，桌面不变——置灰是「有这个工具，这本书不给开」，省掉是「这个形态没有这种东西」。
- 书按需下载。手机的 books 通道仍是 off（不对齐 library.json），书架上没下载的 EPUB 显示为在云端，点了从 Drive 拉这一本，拉完打开；PDF 永远不拉。这是 docs/13「书按需下载」的第一次落地，只在手机形态。反方向是手机导入：topic 书架上的 Import EPUB 按钮只收 EPUB（字节用 `isEpub` 复核），选中即读字节进库、挂进当前 topic，不自动打开；随后经 engine 把这一本传上 Drive（`pushBook`，与下载同一条串行队列，远端已有就跳过）。没登录就不传，传失败只提示一句；两种情况都没有补传，之后登录了这本书也只在手机上。2026-09-21 起每道门都在门口入库：桌面「添加文件」和分享进来的书都是选中即读字节、进库、连哈希一次写进 topics.json。书架上仍可能有库里没有记录的行——旧版本写下的，或者 topics.json 的修订先到而 library.json 没到——这时按文件名判 epub/pdf，两样都不是就说不知道，点了只说还没入库，不当成 PDF，也不去 Drive 拉。书架跟着 pull 刷新（`SHELF_PULL_ROUTE`，topics.json / library.json / deleted-books），不再只在退出阅读器时读一次。

## 坐标系不变

分页表 v2 离屏按固定几何算，与视口无关，手机也算得出同一张表（没同步到就自己算，进度和 iPad 一样显示 Rendering…）。手机顶栏显示的页码就是表里的块号，`printedLabel` 也照 docs/64 显示。

阅读位置写的仍是 `ViewState`：`cfi` 是屏幕顶部第一个可见字，`pageIndex` 按表查，`scale` 写 `"auto"`，`layout` 写 `"vertical"`。iPad 打开同一本按 CFI 落到同一页；手机打开 iPad 留的位置也按 CFI 落。

标注和 docs/64 同一份文件同一种形状：`position` 里一条 range CFI 加 `quote`、`pageIndex`、`pageLabel`、`sortIndex`。手机划的线 iPad 上照常显示，反过来也是；墨迹在手机上不画。

## 重排视图

`src/reading/epub/flow/flow-view.ts`，React 壳 `FlowReaderPane.tsx`，和 `reader-view.ts`/`EpubReaderPane.tsx` 并列。一个滚动容器，spine 文档按顺序各挂一个 shadow host，复用 `page-mount.ts` 的 `mountDocument`/`createPageResources`/`BASELINE_CSS` 和打包字体；书的 CSS 照 docs/64 消毒后保留。单列，宽度随容器，左右 20px，正文 17px、行高 1.6，`img { max-width: 100%; height: auto }`，比容器宽的表格横向滚动。滚动是原生的（`touch-action: pan-y`），不走 `engine/gesture` 的路由。离屏的文档用 `content-visibility: auto`，估计高度按字数。

纸色照 docs/64「纸色」那一层挂在 host 上，但值由 Aa 里选的纸给（见下），不读 `--page-wash`：阅读屏里只有 Aa 的选择说话，和 app 的护眼开关不叠加。

书内链接照 `reader-logic.ts` 的 `bookLinkTarget` 走；外链走 `platform/app/external-link`。引文高亮是 `FlowReaderView.highlightQuote(pageIndex, { searchText, displayText })`，调用方是课堂里点的引文（[77](./77-手机EPUB课堂.md)）。它和 iPad 的 `ViewInstance.highlightQuote` 同一个签名、同一套找法：`reader-logic.ts` 的 `locateQuote` 按分页表从引用页的起点在摄入树的文本里找字，经 CFI 落到这一列的克隆树上（坑 267），滚到字在视口三分之一处，用 `mark-draw.ts` 的 `drawQuote` 画同一种紫，画在 overlay 自己的 `.rp-quote` 子层里（坑 272）。找不到就停在那页开头、返回 false。下一次点页面、下一次引用、任何 `goTo*` 或 `clearQuoteHighlight()` 都清掉。

## 显示设置

顶栏的 Aa 开一张贴底 sheet，和 Outline 同一种壳。全部即点即生效，没有确定按钮。滚动和翻页的开关在同一张 sheet 里，翻页见 [79](./79-手机EPUB翻页.md)；这一篇讲的是滚动。

- 字号：14 / 15 / 17 / 19 / 21，−/+ 步进，中间那档 17 是原来的。
- 行距：1.4 / 1.6 / 1.85（紧、标准、松），1.6 是原来的。
- 边距：20 / 36（窄、宽），20 是原来的。
- 纸色：White、Paper（`#f6efdc`，就是护眼开关那个值）、Green（`#e4f0de`，同一条乘法）、Dark。默认 White，和 app 关掉护眼时的样子一致。

深色不是乘法——白乘不出黑。Dark 单独一条：滚动容器画成 `#1b1c1e`，`.rp-wash` 关掉，`html, body` 的背景用 `!important` 压成透明、`html, body, body *` 的 `color` 压成 `#c8c5bf`。书自己写的段落底色、代码块底、表格底留着；图片不动，`color` 碰不到它。顶栏、笔架、标注弹窗和两张 sheet 跟着深：阅读屏根节点带 `data-reader-paper`，styles.css 里 `[data-reader-paper="dark"]` 重定义那一组 token（外加 Tailwind 自己的 `--color-neutral-700`，笔架的图标用的是它）。sheet portal 到 `<body>`，所以属性要在 `DialogContent` 上再写一次。只有这一屏，styles.css 那句「app 不做深色模式」照旧成立——这是一张纸的颜色，不是 app 的主题。

改字号、行距、边距之后位置不跑：`FlowReaderView.setDisplay` 改完每份文档的基线 `<style>`，再走 `relayout()`——标注矩形全部失效，按当前 CFI `settle` 回同一个字。宽度变化走的是同一个入口（原来的 ResizeObserver）。`intrinsicHeightEstimate` 吃当前排版参数，离屏文档的估高跟着字号和边距走。

偏好存 localStorage（`phone-display`），不进同步：iPad 有自己的纸，这是这台手机的显示偏好。默认值、档位表、读写和校验（坏值按字段回默认，不整份丢）在 `reading/epub/flow/flow-display.ts`。`FlowReaderPaneProps` 带初值，pane 挂载时就是上次的设置，不会先 17px 再跳。

## 外壳

`PhoneApp.tsx` 的导航栈加三种屏：`library`（topic 列表）、`topic`（一个 topic 的材料，封面网格复用 `shelf/BookCard`）、`reader`。首页加一张 Library 卡，上面带最近打开的一本 EPUB 作续读入口。阅读屏是 `ui/components/phone/reader/PhoneReader.tsx`：自己的顶栏（返回、书名、页码、Outline、笔架、Learn 按钮），笔架复用 `PenToolbar` 的 `disabled`，阅读区挂 `FlowReaderPane`。打开顺序在 `reading/session/open-epub.ts`：复用 `open-book.ts` 的读位置、`preparePagination`、读标注，之后在后台抽全文和图索引给课堂用（[77](./77-手机EPUB课堂.md)）。

## 验过的

2026-09-16 在 iPhone 17 模拟器（iOS 26.5）上从首页跑到书里，用真触摸驱动，读数来自 app 容器里的文件。
手机壳按宽度和指针选中，iPhone 模拟器自动进的就是它（402×874，`pointer: coarse`）。

书架用种子数据摆了四样：一本真书（10 MB 的中英对照 EPUB，222 页）、一本合成 EPUB、一个 PDF、
一条只有 library.json 记录没有字节的 EPUB。首页 Library 卡上是那本真书加「Continue reading」；
点 PDF 出「PDFs open on iPad and desktop」；没字节的那本标「In the cloud」。

书里：Rendering… 之后是一列正文，顶栏是块号加 `printed`（14 / 222 printed 3）；原生滚动改块号；
长按落一条单词高亮；笔架选 Highlight 再拖落一条跨词高亮；按住再拖（长按延长）也落一条；
点已有标注弹删除，删掉就没了；Outline 跳章，块号和 `printed` 跟着变；AI pen 和 Learn 画着但按不动，
各带一句原因；退回书架再从续读进来落在同一块。盘上 `reading-state.json` 写的是 `cfi` + `pageIndex` +
`scale: "auto"` + `layout: "vertical"`，`annotations-<bookId>.json` 写的是 range CFI 加 `quote`、
`pageIndex`、`pageLabel`、`sortIndex`——和 docs/64 同一份形状。

## 待验

- 真机一次没跑，只跑了模拟器。71 MB 那本在 iPhone 上的内存没量。
- 从 Drive 按需拉一本没跑：这台模拟器没登过 Google 账号，点「In the cloud」出的是
  「This build has no Google account set up」。要验得先在模拟器里登一次。
- iPad 打开手机留下的位置没对过：iPad 模拟器要另装一次 app、另喂一份容器，不是一次就能跑完的事。
- 71 MB 那本、以及图很多的书，重排列的滚动顺滑度没量。
- 「In the cloud」的书下载完，封面在原地出现（不在本机的书不再记成 unreadable，下载后再问一次）：只跑了单测，真机和模拟器都没看过。
