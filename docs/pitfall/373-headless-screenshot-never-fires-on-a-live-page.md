# chrome --screenshot 的 virtual-time-budget 在活页面上永远不到期

## 现象

无头核对重排视图的配色，用 Playwright 装的 chromium 直接截图：

```
chrome --headless=new --window-size=393,760 --virtual-time-budget=9000 \
       --screenshot=out.png http://localhost:5231/?paper=dark
```

进程起来了，页面也加载了（vite 的日志里请求齐全），但命令不返回，PNG 一个都没落盘。挂了三分四十秒还在跑。换 `chrome-headless-shell`、加 `--timeout=20000`、把预算调到 6 秒，五次全部被外层 `timeout` 杀掉（退出码 124），一张图也没有。

## 原因

`--virtual-time-budget` 不是「等这么多毫秒再截」。它把时钟交给虚拟时间，只在页面自己空下来（没有待处理的定时器和网络）时才推进，推满预算才触发截图。阅读器这一页永远空不下来：重排视图挂着 ResizeObserver、滚动 settle 的 `setTimeout`，字体和分页表各自还有 promise 在跑，vite dev 的 HMR 客户端还有一条常开的连接。虚拟时间一格都不走，截图那一步就永远不到。

`--timeout` 管的是页面加载，不是虚拟时间的上限，所以加了也不救。

## 解法

不用 `--screenshot`，自己开 CDP：

```
chrome-headless-shell --disable-gpu --no-sandbox --remote-debugging-port=9333 \
                      --user-data-dir=/tmp/... about:blank
```

然后 `http://127.0.0.1:9333/json/list` 拿 page target 的 `webSocketDebuggerUrl`，用 bun 内建的 WebSocket 连上去：`Page.enable` → `Emulation.setDeviceMetricsOverride`（手机宽度和 `deviceScaleFactor: 2` 在这里给）→ `Page.navigate` → 自己 `setTimeout` 等几秒 → `Page.captureScreenshot`。等多久由我说了算，页面忙不忙都照截。一个 target 连一次，几个 URL 顺着导航过去，比一次开一个进程快得多。

脚本写在 scratchpad 里跑，不进仓库。
