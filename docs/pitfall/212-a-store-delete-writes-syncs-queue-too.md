# 212 store 的删除顺手写了 sync 的队列，断言「盘上没文件」的测试只在全量跑里红

## 现象

给 `deleteRehearsal` 接上 `requestRemotePurge`（坑 208 的解法）之后，`tests/reading/rehearsal/store.test.ts` 里这句：

```ts
await deleteRehearsal("never");
expect(disk.files.size).toBe(0);
```

单文件跑绿，全量跑红：`Expected: 0, Received: 1`。多出来的那个文件是 `sync-state.json`。

## 原因

`requestRemotePurge`（`src/platform/sync/index.ts`）把路径推进队列后，只有 `initialized` 为真才落盘。这个标志是 sync 模块的进程级状态，由别的测试文件调 `initSync` 点亮，`bun test` 全场一个进程，于是「这句会不会写盘」取决于这一趟先跑了谁——和坑 174 同一个根：顺序由文件系统定。

删除一个删不掉任何东西的 id 也会写：队列只按路径去重，不问文件在不在。

## 解法

断言改成只看被测 store 自己的文件，不看整个盘：

```ts
expect([...disk.files.keys()].filter((f) => f.includes("rehearsal"))).toEqual([]);
```

`disk.files.size` 这类"整盘"断言，对任何会碰 sync 的路径都不成立。
