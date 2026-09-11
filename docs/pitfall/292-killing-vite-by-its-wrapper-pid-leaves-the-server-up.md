# 292 按 `bun run vite` 的 PID 杀，杀掉的是外壳，服务器还在端口上

## 现象

在 worktree 里改完源码要重启 dev server（坑 269：`.claude/` 不在 watcher 里，不重启就是旧 transform）。记下 `nohup bun run vite ... & echo $!` 的 PID，`kill` 它，重新起一份，`curl` 返回 200，于是以为新的已经在跑。

实际拿到的还是旧 transform。改了三轮源码，截图一模一样，看上去像改动没生效。

## 原因

`bun run vite` 是包脚本的外壳，真正监听端口的是它 fork 出来的子进程，PID 加 3。`kill` 外壳不带走子进程；新起的那份因为 `strictPort` 撞端口当场退出（这条只在 nohup 的日志里，终端上看不见），`curl` 的 200 是旧服务器答的。

## 解法

按端口杀，不按记下的 PID 杀：`kill -9 $(lsof -ti:<port>)`，然后 `lsof -ti:<port>` 确认为空再起。起完不要只看 HTTP 码，`curl` 那个模块的 URL grep 一句这轮刚加的标识符——服务器活着和服务器是新的，是两件事。
