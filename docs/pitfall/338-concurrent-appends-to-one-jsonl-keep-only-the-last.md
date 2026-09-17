# 同一刻并发追加同一个 jsonl，只剩最后一行

现象：一次讲课回合里 19 次几乎同时的 `recordModelCall`，`model-calls-<device>.jsonl` 里只留下 1 行；旁边走 `appData.appendText` 的 `events-ai.jsonl` 19 行全在。两个 sink 行数对不上，先怀疑的是记录方少写了，其实是写入方把自己覆盖掉了。

原因：`src/memory/usage/log.ts` 和 `model-calls.ts` 的追加是「读整个文件 → 拼上新行 → 原子写回」，而 `recordModelCall` 是 fire-and-forget，19 次调用在同一个 tick 里全部发出。每一次都在 `await io.read(path)` 处让出，于是 19 次读到的都是同一份旧内容，19 次写回互相盖，最后落盘的那次只带着自己那一行。两个同时进行的回合（讲课线程加一个划线线程、或并行的子 agent）之间也一样。

解法：按路径把读-改-写串行化，`log.ts` 的 `writeInTurn` 一条 promise 链，后来的写等前面的写落盘再读。不改成 `appData.appendText`：`memory-usage-*.jsonl` 在同步范围里，靠 `writeTextAtomic` 通知 sync 引擎文件变了（`platform/app/atomic-fs.ts` 的 `onFileWritten`），而 `model-calls-*.jsonl` 为了守住字节上限本来就得读整个文件。时间戳在排队之前取，行上写的是事情发生的时刻，不是轮到它写文件的时刻。
