# 手机读 EPUB

2026-09-16 定。取代 docs/22 的「手机上只做 info，不做书」和「划线永久不做」两条；docs/22 其余照旧。

## 定下的

手机上读 EPUB，不读 PDF。iPad 和 PC 保持 docs/64 的纸页，一行不动。

- docs/22 不做书的理由是 PDFium WASM。EPUB 绕开了它，但 docs/64 的 Letter 纸在 393pt 宽的屏上 fit-width 是 0.48 倍、正文约 7.7pt，纸页在手机上守不住。手机用自己的重排视图。
- PDF 不给手机看。书架上 PDF 的封面照常渲染，点了出一条提示，不打开。
- AI 在手机上全部置灰：笔架上的 AI pen 和顶栏的 Learn this book with AI 都画出来但不可按，各带一句原因。不隐藏：手机是 reading 的一种形态，规矩要在界面上读得出来。以后开放时只摘掉这个闸。
- 长按划线。手指按住不动约半秒起一条高亮，拖动延长，抬手落标注。也可以在笔架上选 Highlight 再拖，两条路落的是同一种标注。点已有标注弹出删除。墨迹不做：手机没有页。
- 手机上只有 Outline 一个侧栏内容，做成 sheet。没有 Marks 列表、备课面板、痕迹列表。
- 书按需下载。手机的 books 通道仍是 off（不对齐 library.json），书架上没下载的 EPUB 显示为在云端，点了从 Drive 拉这一本，拉完打开；PDF 永远不拉。这是 docs/13「书按需下载」的第一次落地，只在手机形态。

## 坐标系不变

分页表 v2 离屏按固定几何算，与视口无关，手机也算得出同一张表（没同步到就自己算，进度和 iPad 一样显示 Rendering…）。手机顶栏显示的页码就是表里的块号，`printedLabel` 也照 docs/64 显示。

阅读位置写的仍是 `ViewState`：`cfi` 是屏幕顶部第一个可见字，`pageIndex` 按表查，`scale` 写 `"auto"`，`layout` 写 `"vertical"`。iPad 打开同一本按 CFI 落到同一页；手机打开 iPad 留的位置也按 CFI 落。

标注和 docs/64 同一份文件同一种形状：`position` 里一条 range CFI 加 `quote`、`pageIndex`、`pageLabel`、`sortIndex`。手机划的线 iPad 上照常显示，反过来也是；墨迹在手机上不画。

## 重排视图

`src/reading/epub/flow-view.ts`，React 壳 `FlowReaderPane.tsx`，和 `reader-view.ts`/`EpubReaderPane.tsx` 并列。一个滚动容器，spine 文档按顺序各挂一个 shadow host，复用 `page-mount.ts` 的 `mountDocument`/`createPageResources`/`BASELINE_CSS` 和打包字体；书的 CSS 照 docs/64 消毒后保留。单列，宽度随容器，左右 20px，正文 17px、行高 1.6，`img { max-width: 100%; height: auto }`，比容器宽的表格横向滚动。滚动是原生的（`touch-action: pan-y`），不走 `engine/gesture` 的路由。离屏的文档用 `content-visibility: auto`，估计高度按字数。

护眼纸色照 docs/64「纸色」那一层挂在 host 上。不做深色模式，照 PDF。

书内链接照 `reader-logic.ts` 的 `bookLinkTarget` 走；外链走 `platform/app/external-link`。`[p.N]` 跳转和引文高亮手机上没有调用方，不接。

## 外壳

`PhoneApp.tsx` 的导航栈加三种屏：`library`（topic 列表）、`topic`（一个 topic 的材料，封面网格复用 `shelf/BookCard`）、`reader`。首页加一张 Library 卡，上面带最近打开的一本 EPUB 作续读入口。阅读屏是 `ui/components/phone/PhoneReader.tsx`：自己的顶栏（返回、书名、页码、Outline、笔架、Learn 按钮），笔架复用 `PenToolbar` 的 `disabled`，阅读区挂 `FlowReaderPane`。打开顺序复用 `open-book.ts` 里能用的头几步（读位置、`preparePagination`、读标注），不抽全文、不抽图、不读线程、不蒸馏：桌上没有 AI。

## 待验

真机一次没跑。71 MB 那本在 iPhone 上的内存没量。
