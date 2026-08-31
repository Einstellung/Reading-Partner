# 208 文件级删除过不了同步，删掉的观察会自己回来

## 现象

在一台设备上删掉一条 AI 观察（`memory-<topicId>/m-<id>.md`），过几天它又出现在 prompt 里。本机没有任何报错，UI 也没有任何提示。

2026-08-31 实测项目发起人的库，topic `b3a9f89c-ae9d-492e-8f69-4e12689af1b1`：目录里 106 个词条文件，`index.md` 只有 103 行。差的三条 `m-fb109f9c`、`m-0fe3bfb7`、`m-883ca3e9` 都是被合并进别的条目后有意删掉的（`m-4dfdae84` 和 `m-7923bb7c` 的正文写着删除这件事）。`sync-state.json` 里 `m-883ca3e9.md`、`m-fb109f9c.md` 的本地 mtime 是 2026-08-21T13:56、rev 1，比记录删除那条观察晚了一周——它们是从另一台设备下回来的。

## 原因

`platform/sync/reconcile.ts` 按设计不传播文件级删除：本地没有、远端有的文件一律留着，同步永远不销毁任何东西。所以删除只发生在本机，另一台设备照旧持有那个文件，下次它改动该文件就以更高 rev 重新发布，文件回到本机。

`store.ts` 又把词条文件当唯一真相、`index.md` 当派生：下一次 `observation_update` 触发 `rebuildIndex()`，它看到 106 个文件、写出 106 行的 index 并上传，三条删掉的观察静默回到上下文里。

## 解法

删除要写成一条会随同步合并的记录，而不是一次文件消失。`memory-<topicId>/deleted-observations.jsonl`，一行一条 `{"id":"m-1234abcd","at":"2026-08-31"}`，走 records 合并策略（`platform/sync/merge/records.ts` 的 `lines` 形态，行本身就是身份），两台设备的墓碑取并集，永远丢不掉。`list()` 和 `rebuildIndex()` 从磁盘上的词条文件里减去被墓碑标记的 id；`get()` 对被标记的 id 一律答 null，即使文件还在。

刻意只记"哪些被删了"，不记"有哪些"：iPad 上跑的是旧的 TestFlight 版，桌面既升不了也测不出，一份"有哪些"的清单会把旧版新建的每一条都判成不存在。
