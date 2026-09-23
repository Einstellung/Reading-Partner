# xvfb-run 起的显示，xwd 直接截会被拒

## 现象

`xvfb-run -a` 起的 Tauri app 跑在 `:100` 上，`xwd -root -display :100` 退出码 1，什么都截不到。

## 原因

`xvfb-run` 给它的 Xvfb 生成一份临时 `Xauthority`（`-auth /tmp/xvfb-run.XXXX/Xauthority`），只有带同一份 cookie 的客户端能连。另一个 shell 里跑 `xwd` 没有它。

## 解法

从 `ps` 里读出 `-auth` 那个路径（或 glob `/tmp/xvfb-run.*/Xauthority` 取最新的），`XAUTHORITY=<那个文件> xwd -root -display :100`。xwd 的原始输出用 PIL 按头里的 `bytes_per_line`/`bits_per_pixel` 解成 RGB 存 PNG，不需要 ImageMagick（这台机器没装 `convert`）。脚本在 scratchpad `epub-pages/shot.py`。
