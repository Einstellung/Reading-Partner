# vite 的 1420 是 strictPort，上一轮残留的进程让下一轮起不来

现象：重跑 `tauri ios dev`，还没开始编译就退出：

```
WebSocket server error: Port is already in use
Error: Port 1420 is already in use
error: script "dev" exited with code 1
Error The "beforeDevCommand" terminated with a non-zero status code.
```

原因：`vite.config.ts` 里 `strictPort: true`（Tauri 要求固定端口），端口被占就只能失败，不会自己换一个。占着 1420 的是上一轮跑失败留下的 vite 进程，`pkill -f 'bun.*vite'` 匹配不到它。

解法：启动前按端口杀，`lsof -nP -iTCP:1420 -sTCP:LISTEN -t | xargs -r kill -9`。
