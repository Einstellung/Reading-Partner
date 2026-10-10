# pi-durable 的 id 是自增整数，不是 UUID，读不出时间

## 现象

pi-durable 1.1.0 的 `ConversationId`、`SubmissionId`、`TaskId`、`EntryId` 运行期都是数字（`Id<Kind> = number & brand`），MemoryStorage 和 SQLite 一样从小整数往上数，所有种类共用一个计数（会话 2、submission 10、任务 13）。

## 原因

存储的 `mintId()` 发的是库内自增序号；README 说的 UUIDv7 只是 `pi.provider` 里给 provider 的 session id。

## 解法

要从 id 推时间戳（落盘消息的 ts）推不出，换成 `rp.turn` 的输入里记下开始时刻再按段号递增（`src/legion/durable/turn.ts` 的 `projectRun`）。换代后计数从头来，按 id 缓存的东西换代时一起清。
