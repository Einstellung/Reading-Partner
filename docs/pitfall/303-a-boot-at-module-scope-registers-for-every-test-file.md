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
