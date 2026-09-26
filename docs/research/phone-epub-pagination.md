# 手机 EPUB 左右翻页：做法与实测

2026-09-26，Mac mini 上 iOS 26.5 模拟器（iPhone 16 393pt、iPhone SE 3 375pt）实测。探针在 `scripts/paginate-probe/probe.ts` + `paginate-probe.html`，用的是 app 自己的 `parseEpub`、`mountFlowDocument`、`flowBaselineCss`、`caretAtPoint`，跑在真 app 的 WKWebView 里（`tauri ios dev`，页面经 sim bridge 导航过去），触摸走 idb。样本是 Gutenberg 公版书，没进仓库。

## 推荐做法

一次只排一个 spine 文档：沿用 flow 的 shadow host 和 `flowBaselineCss`，在 `.rp-paper` 上加 `column-width: W-2padX; column-gap: 2padX; column-fill: auto; height: H`，一列一屏，第 k 页就是第 k 列。翻页用 JS：阅读区自己接 touchstart/move/end（`touch-action:none`，touchmove 和 touchend 都 `preventDefault`），拖动时平移 `.rp-paper` 的 `transform`，松手用 CSS transition 落到整页；点按左右区域翻页。前后相邻的 spine 文档在空闲时离屏预排，跨章翻页不等。手机屏页是本机、本字号的临时页，不进分页表；引用坐标、存盘位置、顶栏页码仍是分页表 v2 的 CFI 和页号，屏页和表页之间按 CFI/Range 换算，每次换算不到 1 ms。和 page-ruler「同源」落在同一套挂载和基线代码、同一种「量 Range 落在第几列」的做法上，几何不同源：表页是 Letter 纸 720px 版心，手机一屏约是它的四分之一，两者不能对齐，也不需要对齐。

## 实测数字

最大章节：《尤利西斯》（pg4300）第 15 章 Circe，231,075 字符、253 KB XHTML、2,812 个元素。带图：《爱丽丝》Rackham 插图版（pg28885）第 6 章，6 张图、13,879 字符；《远大前程》插图版（pg1400）15 MB，78 个文档里多数是一图一文档。

| 项 | 393pt（app，版面 393×715） | 375pt（app，舞台宽 375） | 375pt（SE Safari，375×505） |
|---|---|---|---|
| Circe 首次排版（挂载到拿到列数） | 55-66 ms，327 页 | 62 ms，343 页 | 82-86 ms，507 页 |
| 改字号重排并落页 17→21 | 76-78 ms，492 页 | 81 ms，517 页 | 88 ms，767 页 |
| 21→14 | 51-54 ms | 53 ms | 55 ms |
| 14→17 | 35-36 ms | 37 ms | 41 ms |
| 遍历全部 3,440 个文本节点、给每个定页 | 8-9 ms | 7 ms | 10 ms |
| 任一偏移 → 页 | ≤1 ms | ≤1 ms | ≤1 ms |
| 爱丽丝插图章首次排版 / 改字号 | 8 ms，23 页 / 4-11 ms | | |

翻页帧（模拟器 60 Hz，rAF 间隔；每组 3 次左滑、3 次右侧点按、1 次右滑、1 次 0.08 s 快划）：

| 方式 | 中位 | 最长帧 | 备注 |
|---|---|---|---|
| JS 拖动 + transform（app） | 17 ms | 17-27 ms | SE Safari 第一次拖动有一帧 145 ms，app 里没复现 |
| 点按 + CSS transition（app） | 17 ms | 42-47 ms，每次一帧 | 见坑 434 |
| 点按，touchend `preventDefault`（app） | 17 ms | 22-26 ms | |
| 原生横向 scroll-snap（app） | 17 ms | 19-22 ms | 每次滑动恰好一页，快划也不跳页（`scroll-snap-stop: always`） |

内存（WebContent `phys_footprint`，方法见坑 433）：同一会话空探针页 195-212 MB；Circe 分页后读到 132-154 MB，落在噪声里；按 flow 阅读器的形状把《尤利西斯》21 个文档全挂上（`content-visibility:auto`），挂载 69 ms，+16 MB，滚过全书后 +40 MB。纯文字书上内存不是两种形态的分水岭。《远大前程》全书挂载那组没量成（探针两次都没报 ready），图多的书两种形态的差值还没有数。

这些都是模拟器在 M 系 Mac 上的数，CPU 比手机快，GPU 是模拟的。可以拿来比方案之间的相对大小，绝对值要上真机复核。

## 开源实现怎么做

- foliate-js `paginator.js`：每个 spine 文档一个 iframe，`columnize()`（309-340 行）在 `documentElement` 上设 `column-width`/`column-gap`/`column-fill:auto`/`height`，另加 `-webkit-line-box-contain: block glyphs replaced` 防 WebKit 裁字形；`expand()`（362-410）把末列补成整页；翻到第 N 页靠 `scrollLeft`，拖动时自己 `scrollBy`（823-864 的 touch 处理，touchmove `preventDefault`），松手按速度 snap。字号改后按保存的锚点 Range 回到原处（`#anchor`，754-761）。图片 `max-height` 设成版心高、`break-inside: avoid`（341-361）。进度按字节加权分数 + 每 1500 字一个 location（`progress.js`）。
- Readium ts-toolkit：列宽列数由 readium-css 的 CSS 变量给，`ColumnSnapper.ts` 自己接触摸，滑动中写 `scrollLeft`，越界回弹才用 `translate3d`（331-341）；注释写明 Safari 的 IntersectionObserver 不回调，改用逐元素量 rect（81-118）；奇数列补一个 `break-before: column` 的空 div（`helpers/document.ts:164-211`）。改字号只按像素重新吸附，没有锚点恢复。
- Readium swift-toolkit：列同样在 `:root`（`ReadiumCSS-after.css:73-160`），翻页交给 WKWebView 自己的 `UIScrollView.isPagingEnabled`（`EPUBReflowableSpreadView.swift:56`），程序翻页用 JS `scrollBy`；改设置时记下 Locator、整页重载、按引文锚点回位（`EPUBNavigatorViewController.swift` 的 `reloadSpreads`）。原生分页是它能做而我们在网页层做不到的。

我们的差别：阅读区已经是 shadow host 而不是 iframe，挂载代码现成；点按区、左缘返回、长按划线、Lumen 都在 JS 里判，所以翻页手势也放 JS，一处仲裁，不和浏览器抢。

## 和现有功能的冲突与解法

标「推」的是读代码推的，没有实测。

- 左缘返回 vs 右滑上一页：实测 transform 模式里从 x=6 起的右滑落进 24px 边带，探针判给返回、没有翻页；竖滑不动页。原生 scroll-snap 模式同一笔右滑把页翻回去了，要么放弃 snap，要么让边带在第 3px 抢走触摸（`edge-back-gesture.ts` 现有的 `TOUCH_CLAIM_PX`，坑 117 说 WebKit 上抢第一个 move 就够，推）。做法：起点在 24px 内归返回，其余右滑翻上一页，和 iPad 纸页一样。
- 点按区 vs 点标注、点链接：先走现有的命中测试（`followLinkAt`、marks 的点中判断），都没中再按区域：左 30% 上一页、右 30% 下一页、中间不做事（点中间唤出顶栏底栏已否）。touchend 一律 `preventDefault`，链接由自己分派，顺带去掉坑 434 那一帧。
- 长按划线：实测长按 0.9 s 在翻过去的第 27 页上照样拿到 caret、标出单词（`se-ulysses-transform-after-gestures.png`）。坑 261 那种滚动容器抢走拖动的事在这里没有：阅读区不滚，touchmove 全取消（推）。
- 跨页选区/划线：实测一个从本页末行到下一页首行的 Range，`getClientRects()` 在两列各给出一组矩形（第 19 页 6 个、第 20 页 20 个），标注按矩形画，两页各画各的，存的仍是一条 CFI 区间。拖动延长时手指停在右缘 30px 内约 0.6 s 自动翻页再接着延长（Apple Books 的做法）；这一笔 idb 发不出来（坑 333），要用 GestureDriver 的 `press-drag` 验，没验。
- 笔架 Highlight 拖动：同上，按下即开始划，不再有长按等待；和翻页的区分只靠当前拿的笔（推）。
- 引文回到书里标紫：`highlightQuote` 已经把引文变成列树上的 Range，取它第一个矩形所在的列翻过去，引文跨页时停在起点那页，两页都涂紫（推，换算本身实测 ≤1 ms）。
- Outline 跳章：挂上目标文档，锚点元素的 rect 换成列号（推）。
- 位置保存与恢复：写的时候取当前列第一个可见非空白字符（探针的 `anchorOfPage`），出 CFI，`pageIndexOfCfi` 出表页号，照旧写 ViewState 的 cfi+pageIndex，iPad 读得懂；读的时候 CFI → Range → 列。`top-edge.ts` 的探点逻辑换成在当前列左上角探即可（推）。
- Aa 改完停在哪：停在含锚点字符的那一页。实测 17→21→14→17 连改三次，从第 40 页漂到第 38 页：每次重新取锚点，锚点落在新页中间，下次再取就往前挪。解法是锚点只在用户翻页、跳转时更新，连续改设置都用同一个锚点（foliate 的 `#anchor` 就是这样）。纸色画在滚动层和 host 上，不画在多列元素里：`.rp-wash` 只有第一列那么宽（推，截图里版心外一圈底色不一致）。
- 插图和图卡：图 `max-height` 设成版心高、`object-fit: contain`、`break-inside: avoid`，实测爱丽丝插图整幅落在一页（`a393-alice-img-transform-pd-after-gestures.png`）。一图一文档的书（pg1400）每张图自成一页。比版心宽的表格：flow 里是 `display:block; overflow-x:auto` 横滑，分页后横滑归翻页，表格要么缩放到列宽，要么点开全屏看（推；坑 283 说表格被切进多列会让页首跑到前一列）。
- Lumen 拖动：它是阅读区之上的独立元素，自己拿 pointer，不经过阅读区的 touch 处理（推）。
- 跨章：一个文档是一条列带，翻过末列时换下一个文档的列带；前后文档空闲时离屏预排（Circe 这种最大章也就 55-86 ms，普通章 10 ms 量级）。

## 页码与进度

屏页不写进任何存盘结构。顶栏继续显示分页表 v2 的页号（和 iPad 同一个数，[p.N] 引用照旧），由当前页首字符换算；另可加「本章还剩 k 页」，k 就是当前文档的列数减当前列，免费。不显示全书屏页总数：要把每一章都排一遍才知道，而且一改 Aa 就全变。Circe 一章 327 个屏页，按表页 Letter 版心每行约 90 字估，表页大约是它的四分之一（推）。

## 滚动模式留不留（由你定）

- 只留翻页：flow-view 的滚动路径（`flow-view.ts` 的 scroll/pinned/relayout、坑 366 那类 scrollTop 问题）退役，但全书挂载那一套也要换成按文档挂载，改动面最大；以后长表格、代码块这类不适合分页的内容没有退路。
- 两种都留：Aa 里一个开关。两套定位（scrollTop 和列号）、两套手势、两份验收，每个新功能（划线、引文、课堂跳回）都要在两种形态下各验一遍。flow 的全书挂载和按文档挂载并存。

## 存疑

- 所有帧率和内存都是模拟器的，真机没跑。
- 按住再拖延长划线、拖到页边自动翻页没验（要 GestureDriver）。
- 图多的书全书挂载的内存没量成；真 app 的 flow 阅读器这次也没打开：`simctl openurl` 投进容器 Documents 的 EPUB 没到 app，停在首页。
- 横排以外（竖排、RTL）没看。
- 坑 434 的原因是推的，只有每组三次点按的数。

## 要拍板的

1. 翻页做默认，滚动留不留成选项。
2. 顶栏页码：只显示表页号，还是加「本章还剩 k 页」。
3. 点按区：左 30% 上一页、右 30% 下一页、中间无动作；还是两侧都往后翻。
4. 翻页动画：平移，还是无动画直接换页。
5. 跨页划线靠拖到右缘停留自动翻页，行不行。
6. 左缘 24px 归返回、其余右滑翻上一页，行不行。
