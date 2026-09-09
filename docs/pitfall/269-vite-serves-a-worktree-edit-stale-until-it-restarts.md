# worktree 里改了源码，跑着的 vite 一直给旧版本

## 现象

在 `.claude/worktrees/<agent>/` 里起 `vite --port 1432` 给 xvfb 里的 Tauri app 用，改完 `css-sanitize.ts`、`location.reload()` 重载页面，探针读到的仍是改之前的行为；单测同一份源码是新的。

## 原因

`vite.config.ts` 把 `.claude/` 整个排除在 watcher 之外（免得 agent 的文件改动触发用户 dev server 的热重载）。worktree 就在 `.claude/` 下，vite 看不到改动，transform 缓存不失效，重载页面拿到的还是缓存。

## 解法

worktree 里改源码后重启 vite（`kill` 掉占端口的进程再起），再重载页面。别把「重载了页面」当成「代码是新的」。
