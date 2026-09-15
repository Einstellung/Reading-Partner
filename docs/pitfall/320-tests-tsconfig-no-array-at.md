# 320 测试里用 `Array.prototype.at` 编不过

## 现象

新写的测试用 `log.filter(...).at(-1)` 取最后一条，`bun test` 跑得好好的，绿的；`bun run typecheck` 报：

```
tests/reading/session/switch-document.test.ts(112,35): error TS2550:
Property 'at' does not exist on type 'unknown[][]'. Do you need to change
the 'lib' compiler option to 'es2022' or later?
```

## 原因

`typecheck` 跑两趟：`tsc --noEmit`（源码）和 `tsc -p tsconfig.test.json --noEmit`（测试）。测试那份的 `lib` 停在 es2022 以前，`at` 是 ES2022 的。运行时是 bun，有 `at`，所以测试本身照跑不误——只有类型那一趟拦得住。

## 解法

测试里取最后一个元素写成 `all[all.length - 1]`。别为一个取值改 `tsconfig.test.json` 的 lib。

同一类：`bun test` 绿不代表能过 CI，提交前必跑 `bun run typecheck`。
