# 230 虚拟时间下 PDFium 永远起不来，阅读器探针页拍出来是空的

## 现象

按坑 135 那套拍阅读器：静态产物、本地 http server、`--virtual-time-budget=8000`（甚至 12000）。PNG 正常写出来，侧栏、大纲、顶栏都在，唯独页面那半是一片桌面色，读数里页宽是 0。坑 222 说的「dev server 上不退出」不适用——这是 `vite build` 的静态页，Chrome 秒退，图也齐。

## 原因

`--virtual-time-budget` 把时钟推快，条件是「没有待完成的加载」。PDFium 的启动不是一串加载：wasm 取回来之后要编译、init，再跨 worker 握手，中间靠的是真实的宏任务和 `postMessage` 回合。虚拟时钟在这些回合之间就把预算耗完并截图了，引擎那时还在自己的初始化里，一张页面都没光栅化。资源面板显示 `pdfium.wasm` 200 已经到手，所以看上去像「都加载完了」。

## 解法

拍任何要跑引擎的页面，走 CDP 用真实时间等，别用 `--virtual-time-budget`：

```
--headless=new --no-sandbox --disable-gpu --hide-scrollbars
--force-device-scale-factor=1 --remote-debugging-port=<port>
--window-size=<w>,<h+200> --user-data-dir=<临时目录> about:blank
```

连上以后 `Emulation.setDeviceMetricsOverride` 钉死视口（这样窗口边框和 500px 宽度下限都碰不到，坑 135/220 一并绕开），`Page.navigate`，`Bun.sleep(12000)`，再 `Page.captureScreenshot`。要证明某个改动生效就在同一个连接里 `Runtime.evaluate` 量元素，把数字和图一起留下。
