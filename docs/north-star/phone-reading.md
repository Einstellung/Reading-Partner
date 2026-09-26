# 手机阅读

2026-09-21 定。

## 愿景

手机不是小号 iPad。手机的位置是碎片时间的续读：续读、听、随手问一句、随手划一条留给桌上处理。备课、排练、讲出去留在 iPad 和 PC。

## 已经做的（不属于北极星）

显示设置 Aa sheet：字号、行距、边距、四种纸色含深色，手机阅读屏放开深色。Aa 按钮顶掉笔架上的导航锁那一格。已做，随 v0.21.0 发出，定案见 [70](../reading/70-手机读EPUB.md)。

左右翻页：Aa 里开关切换滚动和翻页，一个 spine 文档排成 CSS 列一列一屏，手势照搬 iPad 纸页，存盘和页码仍是分页表 v2。第一片已做，跨页划线和引文回书是第二片，定案见 [79](../reading/79-手机EPUB翻页.md)。

### PDF 上手机

已做，随 v0.21.3 发出（AI 真回合与真机未验）。

2026-09-22 定：手机上不给读 PDF，纸页视图和重排视图都不给。渲染不完美时用户会归咎于软件，不会归咎于 PDF。

手机上打开 PDF 直接进课堂（lesson）：吃的是 pdf.js 抽出来的正文，不碰 PDFium，不显示版面。用户想自己看页面，用系统预览或分享到别的 app。第一次打开时提醒一句。

PDFKit 插件路线关掉。

课堂的交互形态和正文来源定在 [74](../reading/74-手机PDF课堂.md)：正文用手机本地的 pdf.js 抽，不同步桌面的 fulltext。

语音不在这一步。语音现在只在 info 那条线里，要等全场景语音统一设计之后再接进来。

依据：[pdfium-on-iphone](../research/pdfium-on-iphone.md)（引擎跑得动，但 fit-width 下正文 1.1mm 高、WebContent 峰值 700-760MB、不嵌字体的中文不出字）、[pdfkit-plugin-route](../research/pdfkit-plugin-route.md)（15-20 个新文件跨三种语言，原生视图叠 webview 的 hit-test 无先例，不解决字号问题，Android 分叉）、[pdf-reflow-on-phone](../research/pdf-reflow-on-phone.md)（重排正文能读，公式、无框线表格、标题页三处错法）。

## 认定要做、这次不做的

### Marks 列表

手机能划不能看：没有标注列表，划过的线找不回来；划线不能附一句话；iPad 上从标注开出来的线程手机上看不见。标注和 [64](../reading/64-epub纸页.md) 同一份文件同一种形状，列表数据现成。

### AI 上手机

对着这本书聊在做：2026-09-25 定，顶栏的 Learn 进和 iPad 同一堂课，开书时手机自己抽全文和图索引，见 [77](../reading/77-手机EPUB课堂.md)。笔架的 AI pen 仍置灰（`src/ui/components/phone/reader-gate.ts`）。还要做的形态：选中一段问一句、划线开线程、书里的 pull-to-ask（简报页有，`PullToAsk.tsx`）。

### 听

走路、通勤时把这本书读出来。手机独有、iPad 上不会想要的形态，可能是手机上唯一比 iPad 强的阅读形态。TTS 那条线已有（[33](../info/33-语音简报.md) 语音简报，小米 TTS），Lumen 语音会话已有（[66](../companion/66-Lumen.md)、[68](../companion/68-Lumen与盒子的交互.md)）。

### 小件

书内搜索；字典和翻译（桌面有 `src/reading/translate/`）；章节内进度和剩余量；进度条按块号拖（分页表现成）。

## 已否的

点正文中央唤出顶栏底栏那个模子（起点式）：不要，用独立按钮。
