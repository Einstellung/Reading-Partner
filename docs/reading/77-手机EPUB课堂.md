# 手机 EPUB 课堂

2026-09-25 定。手机读 EPUB 时也能「Learn this book with AI」，和 iPad、PC 是同一堂课。原型：https://claude.ai/artifact/V8rjFcgwA3zdF9WPwCjV2v 。

## 定下的

- 阅读器还是阅读器。顶栏的 Learn 按下去，整屏换成课堂；返回（按钮或左缘右滑）回到离开时的阅读位置，按 CFI 落回同一个字。
- 课堂就是 iPad/PC 的书级线程：`threads-<bookId>.json` 里那一条，两边互相同步。回合走 `reading/session/use-call.ts`（`useCall`），提示词、工具、教法和 iPad 一样，不带 `form: "phone"`。docs/74 的手机 PDF 课堂是另一档（没有页、放开拷问），EPUB 课堂不走那一档。
- 没有画中画卡片。iPad 上微信通话式的 ReadingPipCard / ChatPipCard 手机上两个方向都没有。
- 在页上时 Learn 图标带一个点：回复正在写时闪，写完了还没看过时常亮，进课堂就消掉。
- 回复写到一半回到页上，回复接着写；Stop 只在课堂里。回到页上不挂断：call 留着，只是不画（`showReading`，view 为 `chat-pip`），所以写完的回复算有人在看，落进线程，不进盒子。
- 点引文：离开课堂，书滚到那一段并标出来，颜色和 iPad EPUB 的引文高亮一样。这一版没有「跳回课堂」，回课堂按 Learn。
- 离开这本书和 iPad 关书一样挂断：记 `call-end`，对话交给蒸馏。
- 这一片不做：语音、AI pen、选中一段问。笔架上的 AI pen 仍置灰，原因改成 `The AI pen is not on the phone yet — Learn this book with AI is in the top bar`。

## 和 iPad 共用的

| 东西 | 来源 |
|---|---|
| 课堂对话 | 书级线程，Learn 每次按下由 `resolveBookThread` 读文件 |
| 焦点章 | 线程上的 `focusChapter`，`read_chapter` 写，`useCall` 读回 |
| 章表 | `loadChapterTable`：全文的 outline、章节脊梁的 state、prep |
| 工具 | desk 按数据挂：`read_chapter`、`read_pages`、图、书架和文献工具 |
| 引文 | 同一套 `[p.N "原话"]`，`createQuoteCheck` 对本机全文校验 |
| 图 | `[fig:N]` 卡片，EPUB 的图从压缩包里取，不经 pdf.js |
| 全文没到时那句话 | `bookTextNotice`：Still reading through this book — I can't teach from it just yet. |

## 开书时手机备什么

打开顺序在 `reading/session/open-epub.ts`。读位置、切页、读标注之后，照 `open-book.ts` 在后台起两件事，用的是 iPad 那两个函数（`bookOpenIo.ensureFulltext`、`bookOpenIo.ensureFigures`）：全文按分页表 v2 切，落 `fulltext-<bookId>.json`；图索引落 `figures-<bookId>.json`。分页表这次刚重切过（`recut`），两份旧缓存都作废。

分页表同步，全文和图索引是 `sync: "local"`，每台设备自己抽；表是同一张，页码和 iPad 一致。阅读区不等这两件事，课堂在全文到之前显示上表最后一行那句话，发出去的问题等全文到了再组回合。

线程不在开书时读，Learn 按下时读（book-thread.ts 的理由）。

## 手机不跑的

备课不在手机上起：不 attach 论文预读的 pipeline，按 Learn 不触发章节脊梁。iPad/PC 写好的章节脊梁经同步到手机，desk 从盘上读得到。论文预读的笔记 desk 经 pipeline 读，手机没有 pipeline，所以预读过的 survey 在手机课堂里不带 prep 笔记，也不挂 `read_paper`/`read_note`。

## 已知风险

两台设备同时往同一条书级线程写会丢一边，和 docs/74「已知风险」是同一条：整条 thread 是一条记录，合并时取一份，另一份进 sync-trash。EPUB 课堂和 iPad 用的就是同一条线程，iPad 上开着课堂、手机上又问一句，比 PDF 课堂更容易撞上。不在这一版解决。
