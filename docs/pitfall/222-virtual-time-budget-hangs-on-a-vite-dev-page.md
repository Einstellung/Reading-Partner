# --virtual-time-budget 让无头 Chrome 在 vite dev 页面上永远不退出

## 现象

按坑 135 那套无头截图去拍 dev server 上的页面：

```bash
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --virtual-time-budget=8000 \
  --window-size=1194,921 --screenshot=out.png "http://127.0.0.1:5180/x.html"
```

进程挂住，超时被杀，PNG 一个字节都没写。换 `--user-data-dir`、`--no-first-run` 都没用。同一条命令拍本地 `file://` 的静态 html 是好的，秒出图。

## 原因

`--virtual-time-budget` 要等页面「没有待完成的加载」才把虚拟时间推完并截图。vite dev server 的页面一直挂着 HMR 的 WebSocket，这个条件永远不成立。静态文件没有这条连接，所以只在 dev server 上复现。

## 解法

拍 dev server 就别加 `--virtual-time-budget`：Chrome 会在首帧渲染后截图，React 挂载完的页面已经在图上了。坑 135 的其余部分照旧——窗口开得比画面高 100px，`--force-device-scale-factor=1`。

真需要等一段时间再截（异步读盘填进来的内容），拍 `vite preview` 或 `vite build` 出来的静态产物，那里没有 HMR 连接。
