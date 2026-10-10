# pi-durable 的 hook 抛错不会让 run 失败，请求照发

## 现象

pi-durable 1.1.0，`GenerationTask` 的 `beforeRequest` 里 `throw new Error(...)`：请求照常发出，submission `done`，transcript 里是正常回答，没有任何报错。

## 原因

`HookRunner.each` 对普通抛错的处理是报给 `HarnessOptions.onReport`、接着跑下一个 handler；只有调用已被 signal 时错误才往上抛。hook 不是闸门。

## 解法

要在 `beforeRequest` 里拦下一个请求（budget 量不下、超轮数）：记下拒绝的话，从 hook 外面 `conversation.abort()`（不 await），hook 自己 `await awaitWithContext(new Promise(() => {}), context)` 挂住，abort 取消这个 context 后请求不会发出。run 以 aborted 结算，`rp.turn` 按记下的拒绝落盘（`src/legion/durable/extension.ts` 的 `refused`，`harness.ts` 的 `refuse`）。
