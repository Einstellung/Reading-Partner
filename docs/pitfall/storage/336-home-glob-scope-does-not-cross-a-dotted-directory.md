# 336 `$HOME/**` 的 glob 跨不过带点的目录名，读隐藏目录下的文件被 fs 权限拒

## 现象

2026-09-17 在 xvfb 下用 `scripts/sim-bridge.ts` 驱动桌面 app 截 README 用的图。把测试用的 `relativity.epub` 放在 `~/.cache/rp-readme-shots/` 下，用 fs 插件读它，报 `forbidden path: … not allowed on the scope for allow-read-file`。同样的字节挪到 `$APPDATA` 下就能正常读出来。

## 原因

`src-tauri/capabilities/default.json` 里 `fs:allow-read-file` 给的是 `{ "path": "$HOME/**" }`。`**` 这个 glob 不跨过路径分量里以点开头的目录——`.cache` 就是这样一段。所以"文件确实在 `$HOME` 底下"不足以判断权限会放行，还要看路径上有没有带点的目录名。

## 解法

不改权限配置，把要读的文件放进 app 数据目录（`$APPDATA` 或其子目录）里，那条 scope 是精确匹配、不受这个 glob 限制。真要读 `$HOME` 下带点的目录，得给 scope 显式加一条覆盖该目录的条目，不能指望 `$HOME/**` 通吃。
