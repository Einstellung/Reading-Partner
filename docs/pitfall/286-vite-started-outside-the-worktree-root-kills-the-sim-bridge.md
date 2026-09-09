# vite 起在别的目录，sim bridge 就再也叫不动，只能重启 app

## 现象

agent 的验证脚本里 `cd "$P"`（scratchpad）之后再 `bunx vite --port 1447`，vite 报 ready、端口通，但 `curl http://localhost:1447/` 是 404。tauri dev 的 webview 加载到这个 404，窗口一片白。此后 `drive.py` 每条探针都是 `page never answered`——连 `location.reload()` 那条也一样，因为它也要经过同一条通道送进页面。截图只看得到白屏，看不出是 404。

## 原因

vite 的 root 是它的工作目录，起在 scratchpad 里就没有 `index.html`。sim bridge（`scripts/sim-bridge.ts`）是 vite 插件，eval 走的是页面自己连上来的通道：页面根本没加载，没有客户端，没人接。把 vite 重启到正确目录也不救——webview 停在旧的 404 文档上，仍然没有客户端连回来，而唯一能让它重新导航的手段（reload）正是要经过这条通道的。

## 解法

起 vite 的脚本一律 `cd` 到 worktree 根，别 `cd` 到 scratchpad；起完先 `curl -o /dev/null -w '%{http_code}'` 断言 200 再起 app。已经白屏了就按 PID 重启 app（cargo 已编好，半分钟），不要试图 reload。
