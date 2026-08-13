# WebKit 比 Chromium 晚得多才抢走滚动，而且只抢它真能滚的那个轴

## 现象

坑 70 和坑 71 的数都是 Chromium 无头触摸模拟量的，两篇结尾都写着 iOS 上没验过。在 iPad 模拟器的真 WKWebView 里按同样的方法量一遍，四条结论没有一条照搬得过来。

同一个 `overflow-y:auto` 容器，同一段下滑，非 passive `touchmove` 里按位移决定抢不抢：

| 每步位移 | 第一个 touchmove 的 dy | 最后一个还 cancelable 的 move | 第一个 cancelable=false 的 move |
|---|---|---|---|
| 1px | -1 | -15 | -16 |
| 2px | -2 | -14 | -16 |
| 4px | -4 | -16 | -20 |
| 8px | -8 | -16 | -24 |
| 16px | -16 | -16 | -32 |

抢与不抢的结果（延时 0.6s、每步 4px）：

| 抢的阈值 | 结果 |
|---|---|
| 3 / 10 px | `pointerdown → pointerup`，容器一像素没滚 |
| 20 / 24 / 30 px | `pointerdown → pointercancel`，容器滚了 720-770px |
| 只抢第一个 move | `pointerdown → pointerup`，容器没滚 |

手指快到每步 20px 时，20px 的阈值也抢得住（第一个 move 的位移就是 20），30px 抢不住；每步 50px 时 30px 抢得住，60px 抢不住。

## 原因

四处和 Chromium 不一样。

一，WebKit 从第一个像素起就派发 `touchmove`，位移多小都发。Chromium 要等触点越过自己的 slop 才发第一个，所以那边"页面拿到的第一个 move 已经越过 slop"（坑 71），这边没有这回事。

二，WebKit 判滚动的位移约 16px，Chromium 约 8px。在那 16px 之内的每一个 move 都是 `cancelable: true`，所以慢手指有四到十几个 move 的窗口，不是一击定生死。

三，只 `preventDefault` 第一个 move 就够，后面全放行也不会被接管。坑 70 在 Chromium 上量到的是相反的（"序列不是第一下定生死，是持续的"）。

四，WebKit 看方向。把横向拖动落在只能纵滚的容器上，125 个 move 全程 `cancelable: true`，没有 `pointercancel`，`pointerup` 照常到，容器一像素没滚。坑 70 在 Chromium 上量到的是"判给谁不看那个容器能不能往这个方向滚，照样 cancel"。

接管之后的样子两边一致：一个 `pointercancel`，此后没有 `pointerup`，剩下的 `touchmove` 全部 `cancelable: false`，`touchend` 仍然会来。

阅读区里根本轮不到这套仲裁：页 div 是 `touch-action: none`（坑 37），实测阅读区内每一次手指滑动都是 `pointerdown → 上百个 pointermove → pointerup`，`pointercancel` 一次都没有。

## 解法

不用改。`TOUCH_CLAIM_PX = 3` 和"这一序列每个 move 都 prevent"是按更严的那个引擎定的，在 WebKit 上余量很大：3px 落在 16px 的窗口里，任何一个第一个 move 都满足它。坑 71 那条"取一个小到任何第一个 move 都能满足的数"在 WebKit 上依然是对的做法，只是理由变了——那边是刚好够，这边是窗口宽。

反过来说，任何按 WebKit 调出来的数在 Chromium 上都会翻车：16px 在这里够用，在那边已经晚了。两条约束取交集就是现在的 3px。

## 范围

iPad Pro 11-inch (M5) 模拟器、iOS 26.5、Tauri 的 WKWebView，触摸经 CoreSimulator 的 HID 通道注入（`scripts/ios-sim.sh gesture webkit-claim`）。真机的手指来自真的数字化仪，第一个 move 的位移和采样间隔都由硬件决定，16px 这个数在真机上要复核——但结论不依赖它，见坑 118。
