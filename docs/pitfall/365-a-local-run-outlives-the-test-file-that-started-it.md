# 365 一个 local run 活过了起它的那个测试文件

## 现象

给 soul 的提示词加「这条线程还有什么在跑」之后，`tests/reading/turn-prompt-snapshot.test.ts` 的整段提示词快照多出一行 `[out] fake literature — sent just now`。单独跑那个文件全绿，和 `tests/reading/turn.test.ts` 一起跑就红。快照测试自己一个 run 都没造。

## 原因

`bun test` 把所有测试文件装进同一个进程。`tier: "local"` 的 run 不落盘，活在 `runner.ts` 模块级的那个 Map 里，于是它跨文件存在。`turn.test.ts` 里验 delegate 的那个 worker 故意永不 settle（`done: new Promise(() => {})`），run 就永远停在 `running`，后面每个文件里装配的 soul 都看见它还在跑。

`appRunner().cancel(id)` 也结束不了它：cancel 只是写下「请停」并调 worker 的 `cancel()`，状态要等 worker 的 `done` 真的 settle 才转成 `cancelled`。worker 的 cancel 是空函数，promise 永不 settle，状态原地不动。

## 解法

永不自己结束的假 worker 要能被叫停：`cancel` 解掉自己那个 promise。测试末尾 `await appRunner().cancel(id)` 再 `await appRunner().idle()`，并断言状态真的到了 `cancelled`。

起了 local run 的测试都归自己收尾；判据不是「这个文件绿了」，而是「这个文件跑完，进程里没留下还在跑的 run」。
