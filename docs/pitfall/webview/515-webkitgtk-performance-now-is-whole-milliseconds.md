# WebKitGTK 里 performance.now() 只到整毫秒，亚毫秒的计时全是 0 或 1

## 现象

Tauri app（WebKitGTK 2.52，`xvfb-run`）里量 IPC 往返：300 次 `SELECT 1` 的耗时只有 0 和 1 两个值，p50 0、p95 1、均值 0.22 ms。bun 下同一段代码给出带小数的值。

## 原因

WebKit 为了防计时侧信道把 `performance.now()` 粗化到 1 ms（非 cross-origin-isolated 页面）。

## 解法

亚毫秒的量看均值（大量样本的平均仍然有效），或者一批调用整体计时再除以次数；单次分布的 p50/p95 在这里不可信。
