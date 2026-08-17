# 还原一个根本没存过的缩放，会把 fit-width 顶掉

## 现象

第一次打开一本书，页面只有 612px 宽，缩放停在 1.0，两边空一大片。`ZoomPluginPackage` 注册时明明写的是 `defaultZoomLevel: ZoomMode.FitWidth`（竖排布局），而 1440 宽的窗口上 fit-width 应该是 2.328。

Chromium 无头实测（1440×900，`public/demo.pdf`，14 页）：页框 612×792，滚动容器 `scrollHeight` 11192。同一份文档在引擎级 spike harness 里不传 `?page=` 时是 1424.7×1843.8、`scrollHeight` 26055。真 WebKitGTK 2.52.3 上同样是 612×792 / 11192。

而且改了窗口大小也不会重新适配：1440 缩到 1000，页框还是 612。

## 原因

不是时序，也不是脏存档。开书路径上有一个合成出来的 viewState，它一路被当成"存过的缩放"用掉了：

1. `openingViewState(null)`（`reading/session/open-book.ts`）给一本没开过的书造一个状态，好让布局在第一帧前就定下来。里面的 `scale` 是 `"auto"` —— pdf.js 时代留下的哨兵，意思是"没有存过的缩放"。
2. `EmbedReaderPane` 把它折成数字：`zoom: typeof scale === "number" ? scale : 1`。哨兵到这里变成了真实的 1.0。
3. `wire-engine` 的 `onLayoutReady` 里 `zoomScope.requestZoom(iv.zoom)`，于是 `requestZoom(1)`。

`requestZoom` 收到数字就把 zoom lock 从模式换成数值，插件注册时的 `FitWidth` 当场作废。这也是第二个症状的来源：缩放插件只在 `zoomLevel` 仍是 fit 模式时才在视口变化后重算（坑 40 末尾），换成数字之后转屏和改窗口都不再重新适配。

链条上每一环单看都对：造状态是为了第一帧就有布局，折成数字是为了类型对得上，还原缩放是用户点名要的"记住上次缩放"。合起来才是错的——"没存过"和"存的是 1.0"在 `EmbedReaderPane` 这一步被抹平成了同一件事。

spike harness 对不上也是同一件事：rig 打开它时带 `?page=0&zoom=1`，那是显式要求还原到 1.0，量出来自然也是 11192；不带参数才走 fit-width。

## 解法

"没存过的缩放"要一路保持"没有"，不能中途变成一个数。

- `EmbedViewState.zoom` 改成可选。`EmbedReaderPane` 只在存档里的 `scale` 真的是数字时才带上它，回存时写 `s.zoom ?? "auto"`，进出用同一个哨兵。
- 还原判据收进纯函数 `openingZoom(layout, saved)`（`reading/engine/layout-modes.ts`，有单测）：返回 null 表示"什么都不发，插件注册时的 fit 就是答案"；竖排返回存过的数字；翻页恒返回 null（一整页是当前这块屏幕的适配，不是上次存盘那块屏幕的，和它的存档不带页内偏移是同一条规矩）。
- 页内偏移换算 viewport gap 时用当前生效的 `currentZoomLevel`，不用存档里的数——没存过缩放时那儿根本没有数可除。

实测（Chromium 无头 + 真 WebKitGTK，1440×900）：

| | 页框 | scrollHeight | 改窗口到 1000 |
|---|---|---|---|
| 修前，没开过的书 | 612×792 | 11192 | 不变 |
| 修后，没开过的书 | 1424.7×1843.8 | 26055 | 重新适配到 984.7 |
| 修后，存了 1.5 的书 | 918×1188 | 16788 | 保持 918 |

翻页布局不受影响，前后完全一致（页框 649.3×840.3，fit-page 1.061，存的 1.5 照样忽略）。页边界密度：每页 799.4px 变成 1861.1px，同样滚 12000px 跨过的页边界从 12.9 次降到 6.5 次。但这不是性能修复——页大了 2.33 倍，每 1000px 滚动的光栅面积反而从 1.08 Mpx 涨到 2.67 Mpx，按页宽读本来就该多画。
