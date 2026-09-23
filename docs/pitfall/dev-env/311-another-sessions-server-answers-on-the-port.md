# 端口上答话的是别的会话的服务器

## 现象

截图 harness 照着 scratchpad 里现成的脚本跑：`vite build` 出 `dist-harness`，`cd dist-harness && nohup python3 -m http.server 8731 &`，然后 `xvfb-run shoot.py`。六张图全出来了，尺寸对、页面对，画的却是改动之前的界面。重建、清缓存、给 URL 加 `?v=3` 都不管用，连截三轮一模一样。

## 原因

8731 是同一个会话里另一个 agent 的 harness 用过的端口，它的服务器还活着，服务的是它那份 `dist-harness`。自己这条 `http.server` 起来就 `OSError: [Errno 98] Address already in use` 退了，但它是 `nohup ... &` 起的，报错只进日志，命令本身返回 0。`curl` 拿到的 200 是旧服务器答的。

## 解法

起完立刻验服务器是自己那份，别验「有没有 200」：

```
curl -s http://127.0.0.1:PORT/harness-lumen.html | grep -o 'assets/[a-z-]*-[A-Za-z0-9_-]*\.js'
```

比对 `vite build` 打印的文件名，对不上就换端口重起。并行会话共用一台机器，端口要按会话取，不要照抄别人脚本里的那个。别杀占着端口的进程——那是别人的（[memory: Never pkill by name]）。

同一个失败模式在自己起的 vite 上是 [292](./292-killing-vite-by-its-wrapper-pid-leaves-the-server-up.md)。
