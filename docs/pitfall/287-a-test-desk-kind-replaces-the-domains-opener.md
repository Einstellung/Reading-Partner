# 287 测试里注册一个同名 desk kind，会把领域的 opener 换掉，整场都算

## 现象

在 `tests/soul/assemble.test.ts` 里加了一个假 item，图省事起名 `item("book", …)`。这个文件单跑全绿，`tests/reading` 单跑也全绿；跑全量套件时 `tests/reading/turn.test.ts` 里 40 多个用例一起红，报错都是同一种：`turn.tools` 只剩灵魂自己的三个工具，书带来的 `read_pages`、`read_chapter`、`search_topic` 一个都不在，systemPrompt 里也没有书。

## 原因

`registerDeskItemKind` 是按 kind 名存进一张模块级 Map 的，注册两次后来的覆盖前面的（`src/desk/registry.ts` 写明「重复注册是第二次启动，不是冲突」）。`bun test` 全场一个进程，模块表和这张 Map 都是共享的。测试里的假 item 用了 `BOOK_KIND`（就是 `"book"`，`src/reading/desk.ts`），于是从这个文件加载起，整场的 `openDesk` 拿到的都是那个什么都不带的假 opener——`openDesk` 不报错，只是 items 里那个位置换了个人。单文件跑不会红，因为红不红取决于哪个文件先跑（同类坑：119、120、175）。

## 解法

测试里的假 kind 一律用领域不会用的名字（`"material"`、`"guest"`、`"teller"`）。要断言真领域的 item，就调它自己的 `register*Desk()`。看到「某个领域的工具集体消失、但那个文件单跑是绿的」，先在测试里搜这个 kind 名有没有被别人注册过。
