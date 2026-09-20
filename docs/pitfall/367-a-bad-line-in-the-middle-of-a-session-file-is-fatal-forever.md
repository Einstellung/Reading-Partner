# session 文件中间坏一行，这台设备的 soul 就永远打不开了

## 现象

用户的 app 每一个 soul 回合都回同一句，连着好几天：

```
Couldn't reach the model. Invalid JSONL storage
/session/--session-soul--/2026-09-18T02-35-27-179Z_01a0b25e-….jsonl: line 67408
```

重启 app 没用，换网络没用，最后只能清 app 数据。报错里的行号一直是同一个。

## 原因

pi 的 `JsonlStorage.open`（`harness/session/jsonl/storage.js`）打开一个 session 就是把整份文件从头回放一遍：每一行 `JSON.parse` 再过 `validateCommitted`（seq 递增、id 不重复、parent 存在），第一行不合格就抛。它只自愈最后一行——文件不以换行结尾时当成写了一半，截掉重写；中间的一行坏了没有任何退路。

我们这边把这条一次性的失败变成了永久的：`openOrCreateSession` 取 lane 目录下最新的那份 session 交给 `repo.open`，抛出来之后 `held.ts` 的 `open` 把 `handle` 置回 undefined，"下个回合重试"——重试就是再打开同一份坏文件。于是第一次坏之后每个回合都死在同一行上。

## 解法

`repo.open` 抛了就把那份文件挪开（`fileSystem.renameFile(path, path + ".corrupt-" + now)`），在同一个目录里新建一份 session 继续跑。`JsonlSessionRepo.list` 只认 `.jsonl` 结尾的名字，改过名的那份再也不会被选中；不删，坏文件是那次 run 写下的唯一一份记录。挪开要用注入的那个 `FileSystem`，和 repo 读的是同一块盘（测试里那块盘是个 Map）。

只在文件内容打不开时挪：盘本身不答应（读失败）照旧抛出去，下个回合重试。两者的区别是 `cause` 链上有没有 pi 的 `FileError`——`session-fs.ts` 的每个失败都是 `FileError`，坏行带的是普通 `Error`。

丢一份 session 的代价是这台设备丢掉"上次没跑完的工具调用还能接着跑"，不是丢历史：session 是机器本地的运行时状态（`src/palace/kinds.ts` 的 `session` 行、docs/71），读者看到的对话是另一份投影。

实现在 `src/legion/execute/harness.ts` 的 `openOrCreateSession` / `setAside`，测试在 `tests/legion/execute/harness.test.ts`。
