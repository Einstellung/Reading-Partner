# pi-durable 的 JSONL 存储：每次部分提交在 main.jsonl 留一行，永不压缩，打开时整份回放

## 现象

pi-durable 1.1.0 spike，`JsonlStorage` 经 `src/legion/durable/durable-fs.ts` 写 AppData，faux 模型 70 token/s 流一段 1440 个汉字（4320 字节）的回答，`tests/legion/durable/crash-child.ts measure`：

| partialIntervalMs | append 次数 | 追加字节 | 结束后 main.jsonl | 结束后其余文件 |
|---|---|---|---|---|
| 100 | 110 | 27.4 KB | 11.7 KB | 0.96 KB |
| 500 | 36 | 16.7 KB | 8.2 KB | 0.96 KB |

部分提交只追加 chord 增量，不重写整段，所以不是平方级。但 `pi.live` 的增量先进 `doc-2.jsonl`（100ms 档写了 13.8 KB），回答结束后被 reclaim（写 `.reclaim` 再 rename）缩回 136 字节；而每次提交在 `main.jsonl` 留一行提交标记，约 48 字节，这部分永远留着。一问一答落盘约为回答本身的 2.9 倍。

## 原因

`main.jsonl` 是提交序列本身，只追加；reclaim 只作用于 `history: "latest"` 文档和在途任务的 sidecar。`JsonlStorage.open` 的 `recover()` 读完整个 `main.jsonl` 和所有 sidecar，在内存里重建一份 `MemoryStorage`，所以打开时间和内存随全部历史线性增长，没有截断或归档入口。

## 解法

存储目录按对话（或按书）分，不要全 app 一份；一个 Harness 只开一个 Storage，所以要并行的对话得在同一个目录里，按目录切就是按 harness 切。对远端同步或慢盘把 `settings.progress.partialIntervalMs` 调到 500，提交次数降到三分之一，崩溃最多丢半秒。
