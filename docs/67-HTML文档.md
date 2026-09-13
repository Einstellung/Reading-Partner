# HTML 文档

> 2026-09-12 定案。上游：[64](./64-epub纸页.md) 是纸页、分页表与字体，[21](./21-info收藏与reading打通.md) 是收藏的入口与确认卡，[09](./09-学习机模式.md) 是链接摄入（`ingest_url`），[61](./61-palace与desk.md) 是 topic 与 desk，[55](./55-legion.md) 是 run 与调度。
>
> 取代关系：[60](./60-info：白宫与Red Boxes.md)「出口：稿」里的渲染与引用那几条作废（react-markdown 渲染壳、没有页、竖滚、按节引用、划线存节号+偏移、图引源站 URL），稿改走本文。21 和未做清单里挂着的「收藏的文章算不算书」在本文答完。

---

## 定位

从网上来的东西怎么读。答案是：和书一样读。

阅读层只有一种东西，叫文档。PDF、EPUB、网页文章、合订本、稿，全是文档，纸页、两支笔、`[p.N]` 引用、书级线程、课堂、prep、retell 一律生效。组织层按 topic 列，一个 topic 里书、合订本、文章并排，文章是没封面的轻条目。

「收藏的文章算不算书」：是同一种文档，不是第二个书库，因为没有第二个列表。21「不做 read-later 坟场」靠入口守：只有用户亲手加的才进 topic，盒里的东西只能浏览（见「盒里的正文」）。

## 存储形态

一篇网页文章摄入时直接构建成一个真 EPUB 文件：单 spine 文档、nav、图片资源，落进 `library/<hash>.epub`，`LibraryEntry.format = "epub"`。从这一刻起它就是一本书，阅读器、分页、CFI、划线、fulltext、prep、retell 一行不改。

分页表按书的规则来：一本一个 `pagination-<bookId>.json`，同步。文章短，表小，但文件数是 app 走 Drive API 的代价（55）。这是有意为之：v1 不为文章另开一条「打开时现算」的路，同步文件数成为问题时再改。

页码依赖同一几何和打包字体（64），所以文档里不能有远程资源。

## 图

摄入时下载，嵌进 EPUB，文件名按内容哈希。下载失败的图换成固定高度的占位块，保留 alt 文字。两台设备要排出同一张分页表，远程图的尺寸取决于网络和缓存，离线打开页码就变。

## 合订本

默认一条链接一本薄书。合订本只在明确要求时产生：一次给一组链接（或 AI 调研出的阅读清单）说「合成一本」，AI 排序、写一章阅读指南放在最前，每篇一个 spine、从新的一页起。它是 topic 里的一个文档，和书并排。

编排（2026-09-14 定）：第一部分按阅读顺序，每篇只留指南点名的节，按标题边界切，图表公式随节，双语；篇末一行「全文见附录 A.n」；指南说通读的短文整篇进第一部分、不进附录。附录放被截过的原文全文，不翻译，目录里单独一组。指南章末尾说明这个编排。截取由指南决定，不读的部分保留可查但不加工。

文件不可变，id 是哈希。往合订本里追加就是新版：出新文件，旧版留着，topic 显示最新版，划线按原文片段搬到新版，搬不过去的标出来。这是 60 对稿定的规则，合订本沿用。

## 封面

PDF 用第一页，EPUB 用它自己声明的封面，文章还是没封面的一行。稿和合订本有封面，由 app 在构建时生成、打进包里当封面图：不联网、不过模型，每台设备同一份字节。

排版是纸色底加衬线字，三行：顶行研究室名 · 日期，中间是文档自己的标题，底行是最强的几个源，取裸主机名，最多三个，按稿末源基评估的强弱排，次要源不上封面。中间那行只能是标题本身，不另外生成一句——封面是标题的再压缩，63 的「标题不强于正文」在封面上同样管用。存疑点和限定语不上封面。

合订本同一套版：中间是卷名，底行 `N 篇 · <日期区间>`，顶行是 topic 或系列名。

不做：拿源站的 og:image（那是那篇报道自己的编辑选择，稿要纠正的报道更是如此），模型生成的图。

字体在 SVG 里写 `"Noto Serif", "Noto Serif CJK SC", Georgia, serif`。书架把 SVG 当图片解码，图片文档不加载 web font，实际画出来的是系统里的回退衬线体。封面只是图，不参与分页，画得不完全一致不影响页码。

## 入口

两个：书或 topic 根聊天里贴 URL；iOS 分享面板进 app。两个入口落到同一张确认卡，就是 21 那张：归到哪个 topic，加一句它对这个 topic 加了什么。点头才落盘进 topic。书内贴入时默认 topic 是这本书的 topic；分享面板进来没有当前上下文，AI 自己提议。

## 和 ingest_url 合并

`ingest_url`（`src/reading/prep/papers/source-tool.ts`）今天把 URL 取回、抽成纯文本、存成 `prep-<hash>/` 里的备课料，只有 AI 用 `read_paper` 读得到，用户打不开。

合并后一个 URL 只产生一个对象：取回的正文构建成 topic 里的文档，prep 的 digest 挂在那个文档上。AI 读的和用户读的是同一份，AI 的引用能落到用户眼前的那一页。`ingest_url` 工具名不变，多的是它落盘的形态。

## 稿

60 的稿走同一条路。模型输出 markdown，markdown 是写作格式不是存储格式：摄入时转 HTML、消毒、构建 EPUB。60 已定的「书架上的文件不可变、再聚合是新文件、划线按原文片段搬」照旧。引用一律 `[p.N]`，「节」的说法作废。

## 翻译

用 app 自己的模型翻，不接外部翻译器。目标语言中文，固定。入口只有一个：在对话里说「这篇翻一下」，没有按钮。翻译用当前对话的模型。

形态是双语对照，逐块追加。每个可译块后面跟一个同类型的兄弟块，`<p>` 后跟 `<p>`，标题后跟同级标题，带 `lang="zh"` 和 `rp-zh` 类；列表项的译文放进 `<li>` 里，不另起一条。公式、`<pre>`、行内 `<code>`、表格、图不翻也不复制；夹在句子里的那几种换成编号占位符再发给模型，回来放回原节点，模型永远不写标签。

译本是新文件，替换 topic 里的原文档。页眉、图片和 nav 与原文一致，走同一个 `packArticleEpub` 打包，分页照样确定。nav 只从原文的标题生成，译文标题不进目录。

划线按原文片段搬（60 的规矩）：逐条拿 verbatim quote 在新文档里重新定位，搬不过去的报给用户，不猜。

两趟。第一趟拿标题、全部小标题和每块的首句（约 2000 token）问一次，定下术语表；第二趟按连续块切批，一批 1500–2500 源 token，每批带同一份术语表、互不依赖，因此并发跑（走 `legion/execute/limiter`，并发 4，429 由它统一退避），回来按文档顺序写回。结构化输出，校验块数和顺序，错一次重发一次，再错整篇失败，在飞的批次一并放弃——不出半本书。

只有 PDF 的论文不在 app 内翻，工具直接说做不到。

## 盒里的正文

Red Box 里 cable 的正文是浏览模式：打开就看，不落盘、不建分页表、不进 topic。划一条线，或者对 AI 说「存一下」，才走上面的摄入路，变成收下的文档。这条属于 info 侧，本文只登记这个接口，不在 v1。它也回答了「arXiv 链接只能跳 Safari」那个悬案：想看但不想存的东西走这条。

## 代码事实

- 网页正文抽取有两个：`src/reading/sources/article.ts` 的 `extractArticle` 是字符串正则、只出纯文本，`ingest_url` 今天用它；`src/info/extract/readable.ts` 的 `extractReadable` 走 Readability 加 defuddle 回退、出 HTML、要 DOMParser，收藏文章的 `html` 是它产的（`src/reading/saved-articles.ts`）。构建 EPUB 要 HTML，用后者，经 `readable-lazy.ts` 那扇门进；`ingest_url` 合并后也换到它。
- 消毒：`src/reading/epub/sanitize.ts` 的 `sanitizeDocument`，允许列表、幂等（坑 126）。构建时先用它过一遍，产出直接就是阅读器要吃的那棵树。
- 入库：`src/platform/app/library.ts` 的 `importBook(bytes, originalPath)`，按内容哈希判重，`formatOfBytes` 嗅探格式。EPUB 字节进去就是一本书，重复摄入同一篇是 no-op。
- zip 写：`fflate` 0.8.3 已装（`src/reading/epub/zip.ts` 用它的 `unzipSync` 读），构建用 `zipSync`，`mimetype` 条目必须第一个且不压缩。
- nav：`src/reading/epub/nav.ts` 读 EPUB 3 的 `<nav epub:type="toc">`。构建时从正文的 h1–h3 生成这棵 nav，Outline 侧栏就有章节。
- `LibraryEntry` 今天只有 hash、title、originalFilename、addedAt、format。

## v1 范围

- `LibraryEntry` 加 `kind: "book" | "article"`（缺省 book，`library.json` 不迁移，做法同 `format`）、`sourceUrl`、`publishedAt`、`byline`。
- 纯函数 `buildArticleEpub({ title, byline, sourceUrl, publishedAt, html, images }) → Uint8Array`：消毒沿用 `sanitize.ts`，h1–h3 生成 nav，图片嵌入，标题页写来源 URL 和日期。单测覆盖：产物能被 `parse.ts` 打开、nav 条数、图片引用全部指向包内、失败的图有占位。
- 摄入：URL → `fetchWithRetry` 取页面 → `extractReadable` 出 HTML → 下图 → `buildArticleEpub` → `importBook` → 补 kind 和来源字段 → 确认卡。PDF 链接照旧走 `sniffContentType` 分流，直接 `importBook`。
- 书架：topic 内文章行没有封面，一行标题加来源域名加日期。
- `ingest_url` 改成上面这条摄入路，digest 挂在产出的文档上。
- 封面：`src/reading/epub/cover-svg.ts` 的纯函数 `typographicCover` / `volumeCover` 出 SVG，`packArticleEpub` 收一个可选 `cover`，写成 `cover.svg` 并在 manifest 上标 `properties="cover-image"`（另写 EPUB 2 的 `<meta name="cover">`），书架原有的取封面那条路不动。稿和合订本的构建器还没有，先只有这一层。
- 翻译核心：`translateArticleEpub(epubBytes, deps) → { bytes, blocks, glossary }`，术语表一趟、切批并发一趟、写回、重新打包，两个模型调用都注入；`carryMarks` 按引文把划线搬到译本。单测覆盖：可译块各多一个兄弟块、公式代码表格逐字不变、nav 和图片不变、再翻一次被拒。

不在 v1，各一句：

- 合订本构建：先有零散文章，再看「合成一本」的频率。
- 分享面板：iOS 那条要动 Swift 和 Info.plist，单独一轮。
- 盒内浏览模式：info 侧的 Red Box 还没生在 palace 里（61 第 6 步）。
- 收藏文章的存量迁移：`saved-articles.json` 和 `SavedArticleView` 先留着，等新路跑稳再把存量按同一函数重建。
- 稿：编辑部还没做，没有稿。
- 只看译文和双语切换：先只出双语对照，等用过再说。
- 翻整本书：形态一样，量级不一样，先只翻文章。

## 与 legion 的关系

摄入是一次 fetch，在用户等待之内完成，不是 run。将来 epub-translator 接进来（translate 作为 run kind，PC 广告能力，子进程执行器）是另一件事，见 55。
