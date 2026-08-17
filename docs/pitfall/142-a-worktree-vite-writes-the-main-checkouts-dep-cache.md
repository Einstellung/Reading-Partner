# worktree 里起的 vite 会改主 checkout 的依赖预构建缓存

## 现象

在 `.claude/worktrees/<name>/` 里用项目自己的 `vite.config.ts` 起一台 dev server 做实验，用户正在跑的 `tauri dev` 跟着重载。同一台 server 还一直吐旧代码，A/B 全是假阴性（坑 55）。

## 原因

两条都来自"worktree 不是一个独立的项目"：

- worktree 的 `node_modules` 是指向主 checkout 的软链，而 vite 的 `cacheDir` 默认是 `node_modules/.vite`。这台 server 的 dep optimizer 于是重写主 checkout 的 `node_modules/.vite/deps`，用户那台 server 盯着同一个目录。坑 55 顺手提的 `--force` 更狠：直接把它清掉重建。
- `server.watch.ignored` 含 `**/.claude/**`，worktree 正在那底下，模块图不失效。

## 解法

一份私有 config（不进版本库），只覆盖这两处，实验脚本一律 `--config rig-vite.config.ts`：

```ts
import base from "./vite.config";

export default {
  ...base,
  cacheDir: `${SCRATCHPAD}/<exp>-vite-cache`,
  server: {
    ...(base as { server?: Record<string, unknown> }).server,
    watch: { ignored: ["**/src-tauri/**", "**/node_modules/**"] },
  },
};
```

每轮改完源码，curl 一下 dev server 吐出来的内容确认是新代码，再开始量：

```bash
curl -s http://127.0.0.1:5319/src/reading/engine/gesture/wheel-zoom.ts | grep -o 'passive: [a-z]*'
```
