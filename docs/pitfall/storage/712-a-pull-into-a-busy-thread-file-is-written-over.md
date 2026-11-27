# 本机有待写的对话文件时 pull 进来的新消息会被写掉

现象：同一本书的 `threads-<id>.json` 里有两条线程 t1、t2。本机往 t1 追加了一条消息，还在防抖里没写盘；这时同步 pull 落地，文件里 t2 多了另一台设备写的一条消息。防抖到期写盘后，文件里的 t2 又没有那条消息了（探针：`t2 on disk: ["c"]`，pull 来的 `d` 不见）。没被本机碰过的 t2 也一样丢。

原因：`createThreadStore` 的 `load` 只有在条目「当前」（gen 没变、`isPending` 和 `writing` 都为假）时才采用文件；否则只 `addMissing`，缓存里已有的线程一条不动。`writeMerged` 按线程合并，`{ ...onDisk, ...entry.threads }`，缓存里的线程整条盖掉文件里的同名线程。于是条目忙的那一拍 pull 进来的消息，既进不了缓存，又被下一次写盘抹掉。下一趟同步时 base 里有这条、本地没有、远端没改，`merge/messages.ts` 按删除处理，另一台设备上的也跟着删。

解法：未修。pull 通知（load 的 `pulled`）只在条目「当前」时宣布新消息，忙的条目什么都不宣布，所以这条路径上界面既不闪也不重复，只是那几条消息从数据里丢了。要修得让 store 对已持有的线程按消息合并（键同 `merge/messages.ts` 的 `messageKey`），并给 `removeMessage` 记消息级的删除，`load` 和 `writeMerged` 两处都要改。
