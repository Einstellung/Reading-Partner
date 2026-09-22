# 手机 PDF 课堂

2026-09-22 定。手机上点开一张 PDF 直接进课堂（lesson），不给纸页也不给重排。取代 docs/22「PDF 仍不在手机上打开」，是 [north-star/phone-reading](./north-star/phone-reading.md)「PDF 上手机」那一节的实施共识。iPad 和 PC 一行不动。

纸页在 393pt 宽的屏上守不住，重排在公式、无框线表格和标题页上出错。渲染不好看时用户归咎于软件，不归咎于 PDF。所以手机干脆不显示版面：AI 用文字带读者过这篇论文，引原文带页码。想看页面用「Open in…」把文件交给别的 app。

## 书架卡片

标记放在文字条里，不压封面。文字条上加一个 `Lesson` 小框（只描边），进度句写 `Not started` / `On <chapter title>`；本地还没抽出全文、拿不到章名时写 `In a lesson`。

`materialTap` 的 PDF 分支从「弹一句 PDFs open on iPad and desktop」改成进课堂；字节不在本地就先拉再进。

## 首次进课堂

贴底 sheet「This one opens as a lesson」，说三件事：手机上 PDF 开成课堂、要看版面用 Open in… 或 iPad、这句只说一次。两个按钮 Start the lesson / Open in…，不做「不再提醒」的勾选。

看过一次记在 `device.json` 的 `lessonIntroSeen`，本机一份，不同步。

## 课堂屏

顶栏四件：返回、书名、章节按钮、Open in… 图标（宿主没有这个能力时不画，Android 就是这样）。没有菜单，没有 Restart。

顶栏下面一条只读的焦点行，和桌面 `ChapterFocusBar` 同一个位置：平时 `Now: <chapter> · p.N`，退出再进写 `Continuing from: <chapter>`。不另做续读横幅。

正文区是纯文字聊天，复用 `CallView` / `MessageList` / `Composer`。引文渲染走现成的 `[p.N "…"]` 引文块。图不出图。

输入区一个输入框、一个发送，外加两个常驻 chip：`I don't follow` / `Skip`。chip 发出去的是读者手打的原话，不是指令。不放麦克风。Lumen 在课堂屏上不画：抬到输入框上方后正好停在正文上，挡字也挡长按。

## 开场和每站的节奏

开场是读者的第一条消息，程序生成的纯函数：要求 AI 先给全文骨架、说明图的政策，然后直接开讲第一站。不问「要不要开始」，也不列可点的章节——跳章只有章节 sheet 一个门。

每一站：讲、引原文、结尾问一个真问题（考读者懂没懂的那种）。答错或说不懂，就摆原文、解释、把问题讲完，不追问第二遍。

拷问在这一档放开，见 docs/09「作废 2026-08-19：拷问」下面 2026-09-22 的补记。提示词里的档位是 `BookDeskRef.form === "phone"`，缺省等于今天的桌面行为；手机档同时撤掉桌面那条「不问读者记不记得」。

图和表只报名字和页码（`Figure 2 on p.5`），可以转述图注原话，不据此描述画面，不假装看过。政策在开场说一次。

## aside

长按一段 AI 回答 →「Ask about this」→ aside 视图。复用 `CallView` 已有的 aside 形态和「Back to the lesson」。回主线时在课堂末尾留一行回执（和桌面同一条规则；长按的通常就是最后一条，两者重合），点回执回 aside。只有一层，aside 里不再开 aside。

## 章节 sheet

照 `PhoneOutlineSheet` 的贴底形态。条目三态：● 当前 / ✓ 已讲 / 空。「已讲」= 该章出现在这条线程的 `read_chapter` 调用历史里且不是当前焦点。

点一站等于发一条用户消息 `Take me to <chapter>`，焦点仍由 `read_chapter` 工具写，不新增写入方。

## 续读

对话和上次焦点都留着。书级线程一本书一条、随账号同步，和 iPad 是同一条：手机上讲到哪 iPad 上看得见，反过来也是。不做折叠，不做「从这里继续」的分隔。

## Android

同一套前端。没有原生 Open in 能力时那个图标不画，其余一致。

## 正文来源

手机本地抽：第一次进课堂时拿到 PDF 字节（不在本地就 `fetchBook`），`ensureFulltext` 用 pdf.js 抽全文，落 `fulltext-<bookId>.json`，之后进课堂直接命中。抽取期间课堂屏显示一行状态。

不同步桌面已经抽好的全文——`fulltext-*` 在同步表里是 `sync: "local"` 的派生缓存，改同步范围要动 palace 表和 dead-paths，比在手机上跑一次 pdf.js 大。pdf.js 抽文本不碰 canvas 也不碰 PDFium，坑 24、25 那两条是渲染路径，抽取不经过。

课堂回合本身不需要引擎在场，它只需要 `Fulltext`。`buffer: null` + `figures: []`，`view_figure` 和页图自然不挂。

## 数据放哪

| 东西 | 存哪 | 同步 |
|---|---|---|
| 课堂对话 | `threads-<bookId>.json` 的书级线程 | 是 |
| 焦点章 | 同一条线程的 `focusChapter` | 跟着线程 |
| 全文 | `fulltext-<bookId>.json` | 否 |
| PDF 字节 | `library/<hash>.pdf`，按需 `fetchBook` | books 通道 |
| 首次提醒已看 | `device.json` 的 `lessonIntroSeen` | 否 |
| 卡片进度句 | 派生：书级线程的 `focusChapter` + 本地章表 | — |

## 不做

语音、深色、划线和 Marks、备课（prep）、页图、EPUB 阅读器里的 AI（`reader-gate.ts` 不动，那个闸仍然关着）。课堂屏不经过 reader-gate。

## 已知风险

两端同时聊同一本书会丢消息。线程的合并语义是 `merge: "records"`，整条 thread 是一条记录，两台设备各自往同一条书级线程追消息时取一份，另一份进 sync-trash。今天就是这样，手机课堂会让它从罕见变常见。不在这一版解决。

卡片的进度句在本地抽出全文之前写不出章名：`focusChapter` 存的是章号，章名要章表，章表要本地 `Fulltext`。降级文案是 `In a lesson`。
