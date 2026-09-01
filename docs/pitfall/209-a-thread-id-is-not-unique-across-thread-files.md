# 209 线程 id 只在单个文件里唯一，跨文件会重名

## 现象

写 0.12 迁移时按线程 id 建全局索引（`Map<threadId, thread>`），跑到项目发起人的真实库上，扫出来 547 条消息；直接把 29 个 `threads-*.json` 的 `messages.length` 加起来是 614。67 条消息在索引里凭空消失，没有任何报错。

## 原因

`threads-<bookId>.json` 的键只在自己这个文件里唯一。info companion 的每日简报会话用的是字面量线程 id `briefing`，一天一个 `threads-info-<date>.json`，25 个文件各有一个 `briefing`。按 id 建 Map 时后写的覆盖先写的，只剩最后一个文件的那份。

同一个坑的第二面：观察里存的旧式锚 `<threadId>:<ts>` 也不是全局唯一的键——`briefing:<ts>` 在理论上可以命中好几天的文件。真实数据里时间戳是真实时钟毫秒，跨天不会撞，但解析代码不能假设它不撞。

## 解法

索引按 id 存一个数组（`Map<threadId, ThreadRef[]>`，`ThreadRef` 带上文件路径），遍历消息时走所有实例。凡是"这个 id 的线程持有这个时间戳吗"的判断，都变成"这个 id 下有几个线程持有它"：正好一个才能往下做，两个以上一律拒绝并报出来，不猜。

见 `src/migrate/threads.ts` 的 `byId` 和 `holdersOfStamp`。
