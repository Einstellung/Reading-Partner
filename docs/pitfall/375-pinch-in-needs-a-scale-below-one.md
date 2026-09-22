# pinch in 的 scale 必须小于 1，脚本的默认值 2.0 必抛

现象：`scripts/ios-sim.sh pinch in` 每次都失败，XCUITest 抛 `velocity must be greater than zero when scale is greater than 1 (NSInvalidArgumentException)`，脚本以 `did not run` 退出。同一轮里 `pinch out` 正常，缩放从 0.656 走到 2.32。

原因：`cmd_pinch` 把 `scale` 原样传给 `XCUIElement.pinch(withScale:velocity:)`，方向只体现在 GestureDriver 取的 velocity 正负上。UIKit 的约定是 scale 本身就带方向——放大传大于 1，缩小传 0 到 1 之间——而 `cmd_pinch` 的默认值对两个方向都是 2.0。于是 `pinch in` 拿到的是「scale 2.0 加一个收缩方向的 velocity」，这个组合 UIKit 直接拒绝。

解法：缩小要显式给一个小于 1 的数。

```bash
scripts/ios-sim.sh pinch out 2.0   # 放大一倍
scripts/ios-sim.sh pinch in 0.5    # 缩回去
```

`pinch in 0.5` 不抛了，但阅读器的缩放不一定跟着回来：实测在 iPhone 17 模拟器上放大到 2.32 之后 `pinch in 0.5` 跑通、`lastStats.zoom` 仍是 2.32。手势到了 WebKit、缩放没到引擎，这一段没查下去；要把缩放放回去用 `handle.zoomReset()`（不是 `resetZoom`，那个名字不存在，调了只抛一个没有 message 的错）。
