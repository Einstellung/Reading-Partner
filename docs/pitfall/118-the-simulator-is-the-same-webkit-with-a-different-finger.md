# iPad 模拟器里是同一个 WebKit，但不是同一根手指

## 现象

`EmbedPdfView.tsx` 里近一千七百行是触摸和引擎的接线，没有一个测试 import 过它，因为验它似乎只有真机一条路。实测下来模拟器能验的比预想的多得多：真 WKWebView、真 PDFium、经 CoreSimulator HID 注入的真触摸，WebKit 自己的手势仲裁全程照跑，橡皮筋、笔手路由、双指缩放都能在里面量出数来（坑 117 的整张表就是这么量的）。

但有几样它永远不会产生，在里面测了等于没测。

## 原因

进去的手指不是真的手指，产生它的两个工具各有各的天花板。

- **没有 Apple Pencil**：`pointerType` 恒为 `"touch"`，`tiltX/tiltY/twist` 恒为 0。路由表里所有 pen 分支（坑 37 的笔放行、坑 46 的 navlock 拦 move、坑 38 的笔占用期间标死手指）在模拟器里一条都走不到。
- **没有接触面积**：`PointerEvent.width/height` 恒为 40×40，`pressure` 恒为 0。坑 38 留的那个问题（"iOS WKWebView 是否真的给出接触面积没有实测过，很可能是常值"）在模拟器这一侧答案是常值，但这正是最可能因为注入路径而失真的一项——真机上要用阅读器 More 菜单里的 Touch debug 重新采。按面积判掌的阈值不能拿模拟器的数去定。
- **一次只有一根手指，除非用 XCUITest**：idb 的 HID 通道只有一个触点，两条 `idb ui swipe` 并发跑会合并成一根（实测 `touches.length` 峰值 1，一个 `pointerdown`）。双指要走 XCUITest 的 `pinch(withScale:velocity:)`，而它只给缩放：`scale` 不接受 1，所以两指平移（质心 pan）驱动不出来；三指以上没有任何注入手段。坑 38 的手指数规则表只有"1 指"和"2 指缩放"两行验得了。
- **不是这台设备的性能**：跑在 M4 上，帧预算、惯性手感、渲染耗时都不是 iPad 的数。

## 解法

按能验的和不能验的分开用。

能验（都实测跑通过）：WebKit 的触摸仲裁与 `touch-action` 语义（坑 117）、纵向橡皮筋两侧的容器 transform（坑 45）、笔手路由的手指那一半连同"不留残笔"（坑 37、44）、双指缩放期间不拖选（坑 38）、翻页、以及引擎能不能在 WKWebView 里把页画出来（本来就有 `ios-simulator-smoke.yml` 在管）。

一条正面证据：坑 67 那个"WebKit 点击 `<button>` 不给它焦点"是在真 iPad 上发现的，模拟器里一模一样——点按钮拿到 `pointerdown → mousedown → click`，`document.activeElement` 从头到尾是 `BODY`，`focus` 事件一次都没有。真机上先发现的行为，模拟器复现得出来。

不能验：任何带笔的路径、按接触面积的掌抑制、三指以上、两指平移、以及一切关于快慢和手感的结论。这些仍然只能上真机。

跑法在 `scripts/ios-sim.sh`：`up` 起模拟器和 `tauri ios dev`（devUrl 就是 Mac 自己的 vite，模拟器和它共用 localhost，所以改前端只是刷新一次页面），`reader` 把 webview 开到 `embedpdf-spike.html`（它把整个 `EmbedPdfHandle` 挂在 `window.__spike` 上，工具、布局、fingerDraw、页码都能从外面设），`gesture <名字>` 跑一个记录过的场景并回一张截图。手势的结果不是靠看截图猜的：`scripts/sim-bridge.ts` 是一个只在 dev 生效的 vite 插件，往每个页面注入一段长轮询，`ios-sim.sh eval` 把 JS 送进那个 webview 再把值取回来，事件序列、`scrollTop`、容器 transform、SVG 笔画数都是这么读出来的。

两个必须知道的坑中坑：一，合成 DOM 事件测不了这件事的核心——WebKit 判不判滚动、发不发 `pointercancel`，全发生在 JS 拿到事件之前，只有真注入的触摸才会触发；二，`tauri ios dev` 在改 `vite.config.ts` 之后重启 vite 会挂住不再监听 1420（页面还连着旧服务器），改完配置要整个 `up` 重来。

## 范围

iPad Pro 11-inch (M5)、iOS 26.5、Xcode 26.6、macOS 26.5。构建走 `bun tauri ios dev "<设备名>"`，无签名；`ios-simulator-smoke.yml` 里那条 `bun tauri ios build --target aarch64-sim --no-sign` 是同一条路的非 dev 版本。
