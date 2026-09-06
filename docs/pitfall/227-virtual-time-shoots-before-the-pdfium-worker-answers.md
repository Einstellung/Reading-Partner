# 227 虚拟时钟不等 PDFium worker，图拍的是渲染之前那一帧

## 现象

核对封面缩略图的静态探针页，`--headless=new --virtual-time-budget=8000` 拍出来四张卡片全是首字母占位块，没有一张真图。页面本身没有报错，控制台里也没有失败记录。同一个产物、同一个 URL，在浏览器里手动打开是有图的。

## 原因

`--virtual-time-budget` 用的是虚拟时钟：主线程队列一空，Chrome 就把时钟直接跳到下一个定时器，而不是按真实时间等。封面这条路上，主线程在 await 一个由 worker 消息 resolve 的 promise——PDFium 的 wasm 抓取、编译、init 和第一页 raster 全在 worker 里跑，是真实 CPU 时间。主线程这时无事可做，虚拟时钟一路跳到 8000ms 预算用完，Chrome 当场截图退出，图里自然是 worker 还没回话时的回退态。

预算调大也不解决：跳过去的是虚拟毫秒，worker 那边的真实耗时一秒都没少，只会先撞上引擎自己的 15s 探针超时。

## 解法

要等异步内容就别用虚拟时钟，改用 CDP 直接驱动：`--remote-debugging-port` 起一个无头 Chrome，页面在渲染完成时挂一个标志（`window.__rig = {...}`），脚本 `Runtime.evaluate` 轮询这个标志，拿到之后再 `Page.captureScreenshot`。bun 自带 WebSocket，几十行就够，不用装 puppeteer。

顺带解决视口：`Emulation.setDeviceMetricsOverride` 给的宽高就是视口本身，坑 135 的「矮 87px」和坑 220 的「500px 下限」都不再需要绕。

判据是页面自己报的那个标志，不是图好不好看：`{"kind":"ok","bytes":16229}` 说明 raster 真跑过，图里没有封面才是排版问题。
