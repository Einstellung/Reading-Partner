# dropThreadCache 不丢缓存，它是从盘上重读；用例之间的会话状态不会被它清掉

## 现象

给 `tests/reading/turn.test.ts` 加了几个用例，断言"最后一条消息带着图"，全挂：最后一条是 `ai` 消息，带图的在倒数第二条。

文件顶上有 `beforeEach(() => dropThreadCache(BOOK))`，新用例用的又是 `input()` 默认的 `threadId: "thread-1"`。单看这个用例，线程应该是空的，`buildReadingTurn` 只该回一条 kickoff。实际拿到的是 50 条：同文件里更早的那个 `HISTORY_KEEP` 用例往 `thread-1` 里追加的。

## 原因

`dropThreadCache` 的实现（`src/platform/app/threads.ts` 的 `store.drop`）不删缓存条目，它调 `load(bookId)` 从文件重读一遍，把读回来的内容合进还活着的那条记录。这是故意的——删掉条目会让"这本书没有会话"成为一个瞬时的真话，顶栏 AI 按钮据此开过第二个空对话——但名字说的是丢，做的是刷新。

于是两头都指向同一个结果：内存里的消息一条没少，文件里的（测试用的假 AppData 整个文件一直活到进程结束）也照样读回来。

## 解法

用例之间要隔离会话状态，就换 `threadId`，一个用例一个 id。`dropThreadCache` 只是在写完之后把内存和文件对齐，不是重置。

同一条对同一个 book id 上的其他 store 也成立：假 AppData 是进程级的，只要 key 一样，上一个用例写进去的东西下一个用例读得到。
