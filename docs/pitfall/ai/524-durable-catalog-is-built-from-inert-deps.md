# 524 durable 运行时的工具表按假依赖建，条件挂载的工具会缺席或换了 schema

## 现象

Linux 桌面验收（xvfb，faux 模型）书回合里模型调 `statement_write`，工具结果是 `Tool statement_write is not available`，回合照常往下走，屏幕上那一行显示 failed。同一本书（Pride and Prejudice）上 `read_chapter` 按 `from`/`to` 调，结果是 `This book has no chapter NaN`；按 `chapter` 调则校验失败 `from: must have required properties`。被杀后重开、safe 工具重跑也是 NaN。

## 原因

pi-durable 的工具登记一个进程一份，名字、描述、schema 来自 `ui/components/common/durable-catalog.ts` 的 `appToolCatalog()`；那里的工厂拿惰性假依赖建。执行时才按对话的 desk 找真工具（`legion/durable/tools.ts`）。模型看到的 schema 和参数校验用的是登记那份，不是 desk 那份。

- `buildStatementTools` 在读者消息没有可用时间戳时不挂工具；目录里给的是 `ts: 0`、`threadId: ""`，于是 `statement_write` 根本没登记。`read_supplement` 则是目录里漏了工厂。
- `buildReadChapterTool` 按书有没有章节表返回两种同名工具：有章节收 `chapter`，没有收 `from`/`to`。目录拿 `chapters: []` 建，登记的是 `from`/`to`；有章节的书 desk 挂的是 `chapter` 那个，模型照登记的 schema 发 `from`/`to`，desk 读 `args.chapter` 得到 NaN。

## 解法

前两个已修：目录给 statement 一条带时间戳的假读者消息、补上 `buildReadSupplementTools`；`tests/soul/tool-contract.test.ts` 断言目录登记了 roster 里的每个名字。

`read_chapter` 两种 schema 共用一个名字没修，要定是拆成两个名字还是合成一个 schema。在那之前有章节的书上 `read_chapter` 每次都失败（真模型也一样，第一轮 Haiku 验收那次 `read_chapter` 的结果多半也是这个）。目录里同名工具只登记第一个，靠 roster 测试抓不到这种「名字在、schema 不一致」。
