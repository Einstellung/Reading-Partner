# spyOn 换一个 ESM 导出，导入方看得见，而且能还原

## 现象

119 的结论是别动模块表：`mock.module` 改的是整张注册表，不回滚，同进程后面的文件跟着倒霉。于是"测试里要替掉被测模块 import 的东西"看上去只剩一条路——把依赖改成参数收。

实测 bun 1.3.11 还有另一条：`spyOn(命名空间对象, "导出名")` 导入方看得见，`mockRestore()` 立刻还原。三种形式都验过：

```ts
import * as dep from "./dep";          // 命名导出
spyOn(dep, "f").mockReturnValue("x");  // 另一个模块里 import { f } 调到的就是 x

import * as mod from "./InfoHome";     // 默认导出
spyOn(mod, "default").mockImplementation(Probe);

// 再导出链（export { g } from "./dep"）：改 index 的命名空间，或改 dep 的命名空间，
// 两边都生效。`export * from "./"` 这种星号再导出，改定义它的那个模块。
```

## 原因

bun 的 ESM 命名空间对象可写，绑定是同一个槽，导入方读的就是那个槽。`mock.module` 换的是整张表并且没有还原入口；`spyOn` 换的是一个属性，`mockRestore()` 把原值写回去。

## 解法

需要替换一个模块导出时用 `spyOn` + `mockRestore()`，还原写在 `finally` 或 `afterEach` 里——spy 期间是全进程可见的，跨出这个测试就是污染，和 `mock.module` 一样脏。`mock.module` 仍然不用。

`tests/reading/session/use-call-hangup.test.tsx` 是完整的用法：模型调用、turn 组装、线程文件、事件日志、蒸馏五个出口全部 spy 掉，测的是 hangup 在哪一刻读线程文件。

## 把导出抄进一张表就读不到那个槽了

`createXStore(io)` 这种在模块底部建单例的写法，io 表在 import 时求值一次。表里写 `loadPdfjs,` 是把槽里的值抄进一个字段，之后 `spyOn(extract, "loadPdfjs")` 改的是槽，那个字段还是原函数。实测：`src/reading/figures/store.ts` 的 io 改成 `loadPdfjs,`，`tests/reading/figures/store-disk.test.ts` 6 个用例红 4 个，真的去开 pdf.js。写成 `loadPdfjs: () => loadPdfjs()` 就把读槽推迟到调用时，spy 生效。

`settings.ts` 一直是箭头（`write: (contents) => writeTextAtomic(...)`），`annotations.ts` 和 `threads.ts` 的 `write: writeTextAtomic` 是抄值那种，今天没人 spy `writeTextAtomic` 所以没炸。新写接线一律箭头。
