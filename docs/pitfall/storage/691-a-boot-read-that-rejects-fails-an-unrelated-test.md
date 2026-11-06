# bootDomains 里不接 catch 的读盘，让别的测试文件红

现象：`bootDomains` 里加了一句 `void loadUserDishes()`（读 `info-meals-dishes.json` 进内存）。三餐自己的测试全绿，全量跑时 `tests/platform/store-errors.test.ts` 的「the bootstrap's effect subscribes while it is mounted, and not after」红了，报错是 `info-meals-dishes.json could not be read`，和那条测试测的订阅毫无关系。

原因：测试里 `renderHook(useShellBootstrap)` 会真的跑 `bootDomains`。测试环境没有 Tauri 的文件系统，`readGuardedJson` 读失败且挪不走文件（`savedAs === null`），`readGuardedFile` 抛错。`void` 掉的 promise 没人接，bun 把这个未处理的 rejection 记在当时正在跑的那条测试头上。

解法：启动时发出去不等的读，照 `useShellBootstrap` 里其他读的写法接 `.catch((e) => console.warn(...))`；读不出来就留着空的内存副本，下一次 pull 或写入再补上（`src/info/meals/dishes/user-dishes.ts` `startMealsUserDishes`）。
