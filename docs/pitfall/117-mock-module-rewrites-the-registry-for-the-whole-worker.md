# mock.module 改的是整个 worker 的模块表，别的测试文件跟着倒霉

## 现象

`bun test tests/reading/turn.test.ts tests/platform/settings-flush.test.ts` 只跑了 turn.test.ts 33 个用例里的 7 个，1 fail 1 error：

```
# Unhandled error between tests
SyntaxError: Export named 'writeTextFile' not found in module
  '.../node_modules/@tauri-apps/plugin-fs/dist-js/index.js'
```

两个文件各自单跑都是绿的。全量 `bun test` 也是绿的——因为 bun 恰好把这两个文件分到了不同的 worker。加一个测试文件或改一个文件名，分配变了就炸。

## 原因

`mock.module(path, factory)` 不是文件级的：它改的是这个 worker 的模块注册表，注册后不回滚，`beforeEach`/`afterEach` 也管不着。同一个 worker 里后进来的测试文件拿到的就是被换过的模块。

炸的那一下是两个 mock 叠在一起：turn.test.ts 把 `@tauri-apps/plugin-fs` 换成了一份只有 6 个导出的假货（够它自己的依赖图用），settings-flush.test.ts 又 `mock.module` 了 `src/platform/app/atomic-fs`——注册一个 mock 会让 import 它的模块重新求值，其中 `platform/app/events.ts` 要 `writeTextFile`，而当时注册表里的 plugin-fs 已经没有这个导出了。

## 解法

被测模块把外部依赖当参数收，测试传假的进去，不碰模块表。settings store 现在是 `createSettingsStore(io)`，`io` 里是读、写、`schedule`/`cancel`、`bindExit`；`src/platform/app/settings.ts` 用真 atomic-fs 和 `window` 建一个单例继续对外导出 `loadSettings`/`saveSettings`。测试自己 `createSettingsStore` 一个，配内存文件加假时钟，顺带连假 `window` 也不用往 `globalThis` 上挂了。

`mock.module` 只在没有别的办法时用，用了就得让那份假货是完整的模块表面。

## 还没修的

`tests/reading/turn.test.ts` 和 `tests/settings.test.ts` 都 `mock.module` 了 `@tauri-apps/plugin-fs`，两份表面不一样，同 worker 相遇一样炸（`Export named 'readFile' not found`）。现在靠 worker 分配躲着。
