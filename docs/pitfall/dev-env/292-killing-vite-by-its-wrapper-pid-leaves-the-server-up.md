# 292 按 `bun run vite` 的 PID 杀，杀掉的是外壳，服务器还在端口上

## 现象

在 worktree 里改完源码要重启 dev server（坑 142：`.claude/` 不在 watcher 里，不重启就是旧 transform）。记下 `nohup bun run vite ... & echo $!` 的 PID，`kill` 它，重新起一份，`curl` 返回 200，于是以为新的已经在跑。

实际拿到的还是旧 transform。改了三轮源码，截图一模一样，看上去像改动没生效。

## 原因

`bun run vite` 是包脚本的外壳，真正监听端口的是它 fork 出来的子进程，PID 加 3。`kill` 外壳不带走子进程；新起的那份因为 `strictPort` 撞端口当场退出（这条只在 nohup 的日志里，终端上看不见），`curl` 的 200 是旧服务器答的。

## 解法

按端口杀，不按记下的 PID 杀：`kill -9 $(lsof -ti:<port>)`，然后 `lsof -ti:<port>` 确认为空再起。起完不要只看 HTTP 码，`curl` 那个模块的 URL grep 一句这轮刚加的标识符——服务器活着和服务器是新的，是两件事。

## 同一条也管上一轮失败留下的进程

`tauri ios dev` 用的是 `strictPort: true`（Tauri 要求固定端口 1420），端口被占就只能直接失败，不会自己换一个：

```
WebSocket server error: Port is already in use
Error: Port 1420 is already in use
error: script "dev" exited with code 1
Error The "beforeDevCommand" terminated with a non-zero status code.
```

占着端口的是上一轮跑失败残留的 vite 进程，`pkill -f 'bun.*vite'` 这种按命令行模式匹配的杀法找不到它——原因和上面一样，真正监听端口的子进程不一定长得像你以为的那条命令行。启动前按端口杀：`lsof -nP -iTCP:1420 -sTCP:LISTEN -t | xargs -r kill -9`。
