# 没有 node_modules 的 worktree 用的是主 checkout 那份旧依赖

## 现象

新开的 agent worktree（`.claude/worktrees/<name>/`）里直接跑 `scripts/t.sh` 和 `bun run typecheck`：60 多个和改动无关的测试失败（info-durable 回合超时等），typecheck 报 `src/legion/durable/tools.ts` 的 `output` 不在 `ToolExecutionResult` 里、`durable-sqlite.ts` 的 `runCounted` 不在 `SqliteExecutor` 里。报错栈里的路径是 `/home/xinyuan/Documents/Github/Reading-Partner/node_modules/...`。

## 原因

worktree 里没有 `node_modules`，bun 和 tsc 往上找目录，找到主 checkout 的 `node_modules`。主 checkout 落后于 origin 是常态，它装的是旧版 pi（1.5 之前），worktree 的源码已经按 `package.json` 的 pi 1.5.0 写了。

## 解法

worktree 里先跑 `bun install --frozen-lockfile`（约 2 秒，装在 worktree 自己目录下，不碰主 checkout），再跑测试和 typecheck。报错栈指向主 checkout 的 `node_modules` 就是这个坑。
