# 305 — JsonlSessionRepo 把 undefined 交给声明为 string 的 absolutePath

## 现象

在 appData 上实现 pi 的 `FileSystem`（`src/platform/app/session-fs.ts`）后，跑 pi 自带的
session 仓一致性测试，17 个用例里 16 个当场炸在我们自己的第一行：

```
TypeError: undefined is not an object (evaluating 'path.startsWith')
  at absolutePath (src/platform/app/session-fs.ts)
  at resolveCreateDestination (pi-agent-core/dist/harness/session/jsonl/repo.js:174)
  at create (…/repo.js:51)
```

`FileSystem.absolutePath(path: string, context: Context)` 的声明里 `path` 不是可选的。

## 原因

`repo.create(options)` 的 `options.cwd` 可以不给，而 `resolveCreateDestination` 不先判：

```js
const cwd = fileValue(await this.fileSystem.absolutePath(cwdInput, context), ...)
```

`cwdInput` 就是那个 `undefined`。pi 自己的 `NodeExecutionEnv` 也没兜住——同一条路径在它上面
炸在 `resolvePath` 的 `normalized.startsWith`。所以这不是我们这份实现的特例，是仓和文件系统
之间没对齐的一条契约，类型签名站在文件系统这边，调用方不守。

## 解法

`absolutePath` 把空的 path 当作 cwd，等价于 node 的 `resolve(cwd)`：

```ts
const from = path === undefined || path === "" ? cwd : …
```

顺带两条同一次量出来的：

- `joinPath` 照 node 的 `join` 语义拼接，一段以 `/` 开头只是一段，不是新的根。拿 `resolve`
  的语义去实现它，一个看着像绝对路径的 session 名就能把文件写到 store 外面。
- 一致性测试里 `fork coordination: publishes fork when it reserves a shared destination id first`
  这一条，文件系统实现过不了：它让 fork 和 create 抢同一个目标 id 并要求 fork 赢，而胜负由
  谁先摸到仓里那个内存 `pendingCreates` 决定，也就是由后端在到达那一行之前花掉几个 microtask
  tick 决定。pi 自己的 NodeExecutionEnv 也是 fork 输（实测），那条是给「预留即事务」的仓写的。
  按用例名单条排除，别整组跳过。
