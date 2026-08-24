# 装在模块顶层的 spy 会挂在别的文件上，`afterAll` 里的还原又恰好在最需要时不跑

## 现象

`bun test` 默认顺序全绿（3583 pass / 0 fail），换个文件顺序就不是：

| seed | 失败数 | 失败落在哪 |
|---|---|---|
| 23 | 62 | turn 18、topics-store 13、reading-state 11、atomic-fs 11、settings 4、threads 4、readable-lazy 1 |
| 2026 | 60 | topics-store 13、reading-state 11、atomic-fs 11、profile 7、turn 6、settings 5、threads 4、chat-scale-store 1、chat-pen-strokes 1、readable-lazy 1 |

`tests/threads.test.ts`、`tests/info/readable-lazy.test.ts`、`tests/reading/turn.test.ts` 里没有一个 spy，挂的却是它们。真正装 spy 的是 `tests/ui/components/chat-scale-store.test.ts` 和 `tests/ui/components/shell-settings-pull.test.ts`，两个文件加起来 4 个，都装在模块顶层。

## 原因

`bun test` 全场一个进程（坑 120）。模块顶层的 `spyOn` 只装一次，装完这个属性就一直是假的，后面每个文件都看得见；`afterAll` 里的 `mockRestore()` 到文件跑完才还原，中间隔着几十个别的文件的用例。文件在模块顶层抛错时 `afterAll` 干脆不跑，而这正是最难查的一种：报错的是那个文件，坏掉的是后面的。

装上全局 `beforeEach(() => mock.restore())` 之后，模块级 spy 反过来从第二个用例起失效，而且是静默失效：属性被换回真实实现，`spy.mockImplementation(...)` 改的是那个已经跟模块脱钩的 mock 函数，用例拿到真货，没有任何报错。

## 解法

`bunfig.toml` 的 `[test] preload` 挂 `tests/support/preload.ts`，里面只有 `beforeEach(() => mock.restore())`；spy 一律装在 `beforeEach` 或用例体里，不装模块顶层。全量耗时不变（20.5s）。seed 23 从 62 fail 降到 40，seed 2026 从 60 降到 48，threads 和 readable-lazy 在这两个 seed 下不再失败。

剩下的失败这条管不了，它们是 `mock.module` 的（坑 119）。seed 47 加不加这条 preload 结果一模一样：116 fail / 53 errors，而且 3584 个用例只跑了 2991 个——`mock.module` 换过的 `@tauri-apps/plugin-fs` 少了导出，后面的文件连链接都失败，整个文件不跑，`Ran ... across 301 files` 那行照样写 301。

`mock.restore()` 只还原 spy：`mock.module` 不还原，手写赋值的 `globalThis.fetch` 也不还原，替的人自己收。
