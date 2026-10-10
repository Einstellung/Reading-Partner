# 403 在 agent worktree 里起的 vite 看不见改动

## 现象

在 `.claude/worktrees/<name>/` 里起 vite dev server 做无头截图，改完源码再截，页面还是旧的；`curl` 那个模块拿到的也是改之前的代码。不报错，不重载。

pi-durable 的 Linux 验收又踩了一次：坑 523 的修复在 app 开着时写进 worktree，重启 app 重测半句仍没进线程文件，于是报成「还有别的原因」。vite 发的还是改之前的 `durable-book.ts`；线程文件的 mtime 停在读者那句写盘的时刻、重启后的落盘根本没写过文件，这一条就能看出来。重起 vite 后同样的杀法（app 里 faux）半句一次落盘。

## 原因

`vite.config.ts` 的 `server.watch.ignored` 有 `**/.claude/**`，本意是不让 agent worktree 的改动触发用户主 checkout 那个 dev session 重载。worktree 自己的 vite 读的是同一份配置，而它的每个文件路径都在 `.claude/` 下面，于是整棵树都不被监听，第一次转换的结果一直缓存着。

## 解法

worktree 里的 vite 每轮改动后按 PID 杀掉重起（app 重启不算，vite 的转换缓存还在），起完 `curl` 一个刚改的模块，grep 刚加的标识符确认是新代码再截图。不要为此改 `watch.ignored`，那条是保护用户 dev session 的。
