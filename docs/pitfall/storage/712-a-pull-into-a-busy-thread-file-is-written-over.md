# 本机有待写的对话文件时 pull 进来的新消息会被写掉

现象：同一本书的 `threads-<id>.json` 里有两条线程 t1、t2。本机往 t1 追加了一条消息，还在防抖里没写盘；这时同步 pull 落地，文件里 t2 多了另一台设备写的一条消息。防抖到期写盘后，文件里的 t2 又没有那条消息了（探针：`t2 on disk: ["c"]`，pull 来的 `d` 不见）。没被本机碰过的 t2 也一样丢。

原因：`createThreadStore` 的 `load` 只有在条目「当前」（gen 没变、`isPending` 和 `writing` 都为假）时才采用文件；否则只 `addMissing`，缓存里已有的线程一条不动。`writeMerged` 按线程合并，`{ ...onDisk, ...entry.threads }`，缓存里的线程整条盖掉文件里的同名线程。于是条目忙的那一拍 pull 进来的消息，既进不了缓存，又被下一次写盘抹掉。下一趟同步时 base 里有这条、本地没有、远端没改，`merge/messages.ts` 按删除处理，另一台设备上的也跟着删。

解法：两边都有的线程按消息合并（`mergeMessages`，键和排序照抄 `merge/messages.ts` 的 `messageKey` / `compareMessages`）。条目上加 `owed`：本机 `patch` 和 `removeMessage` 过的消息按线程和 key 记下改动时的 gen。合并时被记下的消息以缓存为准（删掉的不从文件读回来），其余文件有的消息都取文件的：缓存没有的加进去，两边不同的换成文件那份。`writeMerged` 写出的字节和写完并回缓存都走这条规则；写盘成功后把 gen 不晚于取字节那一刻的记账清掉，写盘途中新改的留着。`load` 在条目忙但读盘期间 gen 没变时也并消息；gen 变了说明读到的可能是那次写盘之前的旧文件，此时记账可能已经清了，所以不并，留给后面那次写盘去并。

并进已持有线程的消息走 `onAppend` 宣布；已有消息被换成文件里的版本（别的设备回答到一半推上来、之后推完整版）带 `update: true` 宣布，阅读的 `row-updated` 和门口的 `withUpdatedRow` 原地换掉那一行。本机在途那条被记账，不换、不宣布。回归测试在 `tests/platform/app/threads-busy-pull.test.ts`。
