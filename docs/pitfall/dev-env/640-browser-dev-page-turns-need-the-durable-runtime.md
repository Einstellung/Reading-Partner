# 640 浏览器 dev 页里装了内存盘，门口回合还是跑不起来

## 现象

按坑 624 装好内存版 `invoke`、`VITE_VERIFY_FAUX=1` 起 dev server 之后，门口对话发一句，回复位置只出红字 "Couldn't reach the model. the turn runtime has not started"。页面首页还挂着 "Configure a provider to begin"，书架上新入库的书也没有被外壳读到。

## 原因

外壳在挂载时就读完了盘：`useBackgroundServices` 当时调 `startReadingDurable`，没有盘就失败；`useShellBootstrap` 读 settings / credentials / 供应商列表；手机的 `entries` 读 `library.json`。内存盘是之后才装的，这些都不会自己重读。durable runtime 的 SQLite 走自定义命令 `durable_sqlite_*`（`src-tauri/src/durable_sqlite.rs`），内存盘不认就回 `null`。

另一个细节：Rust 那边只有超出安全整数范围的整数才包成 `{"$bigint": "..."}`，其余是普通数字。自己实现这些命令时把所有整数都包成 `$bigint`，pi-durable 写 JSON 时会抛 "Do not know how to serialize a BigInt"，会话随即被标成 poisoned。

## 解法

- `durable_sqlite_*` 用 Playwright 的 `exposeFunction` 交给 Node 的 `node:sqlite`（`DatabaseSync`，语句 `setReadBigInts(true)`，读出的整数在安全范围内转回 number）。内存盘的 `invoke` 遇到这些命令就转过去。
- 装好盘之后在页面里 `import('/src/reading/turn/durable-runtime.ts')`，照 `useBackgroundServices` 的参数再调一次 `startReadingDurable`。
- 写一份 `credentials.json`（anthropic 的 oauth，`expires` 设远），再 `dispatchPull(['settings.json', 'library.json', ...])`（`/src/platform/sync/pull-routes.ts`）让外壳按同步到达重读；设置面板开一下再关，供应商列表才刷新。
- 2026-10-15 简报书整条流程的截图就是这么拍的。
