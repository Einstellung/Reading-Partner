# 628 worktree 里起的 vite dev 服务器改了文件也还是旧模块

## 现象

在 `.claude/worktrees/<名字>/` 里跑 `bunx vite`，页面能开；改了某个 `.tsx` 以后重新打开页面（不是热更新，是整页重载、新的无头浏览器上下文），拿到的仍是改之前的模块。`curl http://127.0.0.1:<端口>/src/.../X.tsx` 能直接看到旧的 className。

## 原因

`vite.config.ts` 的 `server.watch.ignored` 里有 `"**/.claude/**"`，本意是不让主 checkout 的 dev 服务器去盯 worktree。worktree 本身就在 `.claude/` 下面，于是在 worktree 里起的服务器把自己的整棵源码树都当成忽略目录：文件变了没有事件，模块缓存不失效。

## 解法

worktree 里改完源码，杀掉自己记下 PID 的那个 vite 再重起，然后重拍。不要为此改 `vite.config.ts` 的忽略规则，那条是保护主 checkout 的。
