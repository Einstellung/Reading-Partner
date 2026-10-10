# pi-durable 的 harness.close() 等正在跑的工具返回，关完任务仍留在旧库里没结束

## 现象

pi-durable 1.1.0 SQLite 后端（`src/legion/durable/sqlite-scenes.ts` 的 `busyClose`，bun 和 Tauri app 里结果一致）：工具执行中调 `harness.close()`。

- 工具不看 `context`（`await gate`）：close 一直不返回，直到 2 秒后放开 gate 才返回（2004 ms）。
- 工具用 `awaitWithContext(gate, context)`：close 2 ms 返回。
- 两种情况关完重开旧库，`tasks` 表里都还有 `pi.generation`（`waiting`）和 `pi.tool`（`running`），工具的结果没有提交。

## 原因

close 取消在途调用的 context 并等调用结束，不替工具中断它；关闭时未提交的步骤按崩溃处理，任务留在 checkpoint 上等下次 `resume()`。存储之间没有迁移任务的接口。

## 解法

工具里的长等待一律经 `awaitWithContext` 或 `context.abortSignal`，否则关 app、换代都会挂在它上面。换代（关旧库开新库）只能在 `inspect()` 没有活任务时做；有任务在跑就先等它结束或 `abort()` 它，直接换库等于丢掉这些任务。
