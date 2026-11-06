# 696 按 `cd && nohup app &` 记下的 PID 杀 Linux 真 app，app 还在，Xvfb 上叠出第二个窗口

## 现象

Xvfb 上验 Linux 真 app：重启 app 后用 sim bridge 点按，DOM 探针说页面已经切到三餐、对话已打开，截图却始终是刚启动时的「今天」页，只有右下角 Lumen 的动画在变。`xwininfo -root -children` 列出两个 1280x860 的 "Reading Partner"。

## 原因

`cd "$W" && DISPLAY=... nohup reading-partner >log 2>&1 &` 里 `$!` 是 `cd && ...` 那个子 shell 的 PID，真正的 app 是它的子进程。`kill $!` 只杀了子 shell，app 被收养后继续跑。GUI app 不占端口，新起的那份不会像 vite 那样撞 `strictPort` 退出（坑 292），于是同一块显示上有两个窗口：bridge 驱动的是后连上的页面，`ImageGrab` 截到的是叠在上面的旧窗口。两份 app 还共用同一个测试 AppData 目录。

## 解法

启动行用 `exec`：`cd "$W" && DISPLAY=... exec reading-partner >log 2>&1 &`，这样 `$!` 就是 app 本身。已经叠出来的，用 `xprop -id <窗口> _NET_WM_PID` 查到每个窗口的 PID，核对命令行是自己 worktree 的二进制再按 PID 杀。截图和 DOM 探针对不上时先看 `xwininfo -root -children`。
