# dev 构建把 dev 二进制写进了开机启动

## 现象

`bun tauri dev` 跑着的时候在设置里打开开机启动，下次开机 app 自己起来，窗口里是 WebKitGTK 的错误页 "Could not connect to localhost: Connection refused"。手动删掉 `~/.config/autostart/Reading Partner.desktop` 没用，再跑一次 dev 又被写回去。

## 原因

`tauri-plugin-autostart` 注册的是当前进程的可执行文件，dev 下就是 `src-tauri/target/debug/reading-partner`。这个二进制的 devUrl 是 `http://localhost:1420`（`src-tauri/tauri.conf.json`），离开 vite dev server 就只有一个错误页。

写回去的是 `applyStoredAutostart()`：每次启动把系统那一份对齐到 `device.json` 里存的意愿，dev 和打包版跑的是同一段代码。

## 解法

`src/platform/app/autostart.ts` 里，dev 构建（`import.meta.env.DEV`）算作没有开机启动这个能力：`hasAutostart()` 返回 false，设置里那张卡片不显示，`setAutostart()` 空转。

启动时的对齐要单独判：`startupAutostartAction(dev, desired, registered)` 在 dev 下无条件返回 `"disable"`，把之前 dev 跑出来的残留注册清掉，而不是 return 了事。平台判断（mobile 没有登录序列）仍在前面。

`device.json` 里存的意愿不动。用户表达的是「打包版要开机启动」，装了正式包才生效。
