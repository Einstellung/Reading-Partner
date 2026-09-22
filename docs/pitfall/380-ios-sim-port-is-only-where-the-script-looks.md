# IOS_SIM_PORT 只改脚本往哪敲，不改 dev server 听哪

## 现象

两个会话要同时用模拟器，第二个照着「换端口避开 1420」设了
`IOS_SIM_PORT=1424` 跑 `scripts/ios-sim.sh up`。app 在模拟器里起来了、
`dev.log` 里 speech 插件都打完日志了，脚本却一直 `waiting for the app to
answer the bridge` 直到超时。

## 原因

vite 的端口写在 `vite.config.ts` 里（`strictPort`），`tauri ios dev` 也从那里
读 devUrl。`IOS_SIM_PORT` 只被脚本自己用来拼 `BASE=http://localhost:$PORT`，
也就是 bridge 往哪敲 `eval`、`cmd_up` 清哪个端口的残留监听。dev server 照旧
起在 1420，脚本却在敲 1424，于是永远等不到回答。

顺带两条同样是实测才知道的：`cmd_up` 开头就 `pkill -f "tauri ios dev"`，别人
会话的模拟器 dev server 会被一起收掉（想并行得改脚本，光换 `IOS_SIM_PORT`
不够）；bridge 的 token 文件按 checkout 路径哈希分目录，和端口无关，所以两个
checkout 之间不会串。

## 解法

别设 `IOS_SIM_PORT`。要真换端口得同时改 `vite.config.ts`，那是另一件事。
1420 被占时先看占它的是谁：如果是自己上一轮留下的，`cmd_up` 会替你换掉；
如果是别人的，停下来问，别硬上。
