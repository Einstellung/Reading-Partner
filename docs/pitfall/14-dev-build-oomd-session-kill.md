# 全量 Rust 编译触发 systemd-oomd 杀整个桌面会话

现象：M5 验收时踩到（2026-07-13）。跑 `bun run tauri dev` 期间整个桌面突然全没了，回到登录界面，像系统崩溃。

原因：新增 Rust 依赖后的首次编译是全量的——十几个 rustc 并行 + debug 链接吃数 GB，叠加桌面常驻应用后内存压力持续超标。Ubuntu 的 systemd-oomd 在 memory pressure > 50% 持续 20 秒后不挑单个进程，直接杀 `user@1000.service/init.scope`（用户会话根进程）＝强制登出。日志实锤：

```
systemd-oomd: Killed /user.slice/user-1000.slice/user@1000.service/init.scope
  due to memory pressure ... 94.08% > 50.00% for > 20s
```

不是机器重启，不是显卡崩，不是 App 代码 bug。

解法：

1. 已进仓库：`src-tauri/Cargo.toml` 的 `[profile.dev]` 设 `debug = "line-tables-only"` + `split-debuginfo = "unpacked"`，链接内存大降，增量开发无感。
2. 习惯：新增/升级 Rust 依赖后的第一次 `tauri dev`（全量编译）别同时开一堆大应用。
3. 可选（系统级，自行决定）：调宽 systemd-oomd 阈值，或 `systemctl edit systemd-oomd` 放宽 user slice 策略。

次要相关：GNOME tracker 索引器会扫 `src-tauri/target/`（8.8G）并可能自己崩（tracker-extract crash）。cargo 会在 target/ 写 CACHEDIR.TAG，多数索引器认它跳过；如仍被扫，考虑系统设置里排除项目目录。
