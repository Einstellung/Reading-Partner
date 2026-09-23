# 在模块作用域 boot 领域，整场测试都看得见

## 现象

`tests/palace/registry.test.ts` 在模块顶层调 `registerInfoDistillSource()` 和
`registerReadingDistillSources()`，`afterAll` 里逐个 undo。加完之后
`tests/memory/distill-sources.test.ts` 里一句 `expect(distillSources()).toHaveLength(1)`
挂了，收到 6。两个文件单跑都绿。

## 原因

`bun test` 全场一个进程（坑 120），`registerDistillSource` 写的是模块级的一张
Map。模块顶层的注册在这个文件被 import 的那一刻生效，而 `afterAll` 要等这个文件
的用例全跑完；中间任何一个文件问注册表，拿到的都是别人 boot 出来的六个源。顺序一
换，同一个断言又绿了。

`mock.restore()` 那条全局 `beforeEach`（坑 171）管不到它：这不是 spy，是真的写进
了运行时注册表。

## 解法

把 boot 放进用例体，try/finally 里 undo：

```ts
function booted<T>(body: () => T): T {
  const undo = [registerInfoDistillSource(), registerReadingDistillSources()];
  try {
    return body();
  } finally {
    for (const u of undo) u();
  }
}
```

断言也按 kind 数，不按注册表总数——总数是全场共享的，只有这一个 kind 是自己的。

## 同一个病根的另一张脸：一个时有时无的工具

`delegate` 工具一开始写成「这台设备一个 worker 都没登记就不挂」，`registerWorker` 同样是没有注销口子的模块级 `Map`：单跑 `tests/reading/turn.test.ts` 全绿，整套跑就有十几条工具清单断言红，清单里多了一个 `delegate`，哪些文件红取决于文件顺序。

生产里同样不干净：外壳 boot 的顺序决定第一个 soul 回合有没有 `delegate`，模型学不会一个时有时无的工具。这条的解法和上面「boot 放进用例体」不同——工具本身不该跟着注册表的有无消失：改成工具无条件挂，「这台设备能跑哪些 kind」写进 `kind` 参数的描述里，一个都没有就在描述里说没有，调用时按 kind 拒绝并说明原因。断言工具清单的测试照着定长清单写，不再跟着注册表变。
