# 假 AppData 的 readDir 不认目录，答的是整条路径

## 现象

给 `appRecordDirIo("legion/runs")` 写测试，写进两个文件再 `list()`，期望 `["r-1.json", "r-2.json"]`，实际拿到 `["legion/runs/r-1.json", "legion/runs/r-2.json"]`。同一段代码在 app 里是对的。

## 原因

`tests/support/appdata-fake.ts` 里 `readDir` 的 mock 整个忽略传进来的路径：

```ts
spyOn(fs, "readDir").mockImplementation(async () =>
  [...disk.files.keys(), ...disk.blobs.keys()].map((name) => ({ name, isFile: true, ... })),
);
```

`disk.files` 是一张扁平表，键是 AppData 相对的整条路径，所以 `name` 是整条路径不是基名，而且不管问的是哪个目录、答的都是整块盘，`isFile` 还恒为 true。

AppData 根上的 store（retell、outline、rehearsal 走 `readDir(".")`）碰不到这一条：根上整条路径就是基名。扫子目录的那四家（`box/`、`legion/runs/`、`legion/bell/`、`legion/ledger/`）会拿到带目录前缀的名字，它们的 `idOf` 一条都不认，于是列表读出来是空的——测试会因为错误的理由变绿。

## 解法

扫子目录的 store 一律把盘换成一张 Map（`createBoxStore`/`createRunStore`/`createBellStore`/`createLedgerStore` 收的就是这个），别拿假 AppData 去验它们的列表。假 AppData 上只钉写进去的路径、读回来的内容、读不到时不抛这几件，目录清单的内容不钉。
