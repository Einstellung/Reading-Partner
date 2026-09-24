# 403 在 agent worktree 里起的 vite 看不见改动

## 现象

在 `.claude/worktrees/<name>/` 里起 vite dev server 做无头截图，改完源码再截，页面还是旧的；`curl` 那个模块拿到的也是改之前的代码。不报错，不重载。

## 原因

`vite.config.ts` 的 `server.watch.ignored` 有 `**/.claude/**`，本意是不让 agent worktree 的改动触发用户主 checkout 那个 dev session 重载。worktree 自己的 vite 读的是同一份配置，而它的每个文件路径都在 `.claude/` 下面，于是整棵树都不被监听，第一次转换的结果一直缓存着。

## 解法

worktree 里的 vite 每轮改动后按 PID 杀掉重起，起完 `curl` 一个刚改的模块，grep 刚加的标识符确认是新代码再截图。不要为此改 `watch.ignored`，那条是保护用户 dev session 的。
