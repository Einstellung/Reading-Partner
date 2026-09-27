# 慢一步的首次读盘把更新的写入盖回旧值

## 现象

iOS 模拟器冷启动后，夜间任务 fold 跑完、`fired.json` 记下 09-26，随后文件被重写成 fold 退回 09-25、housekeeper 09-26，约五分钟后 fold 又跑一遍。在真 webview 里对 `createFiredStore` 复现，结果是 `{"job:a":1,"job:b":2}` 里本该有的另一条记录丢了。

## 原因

`createFiredStore` 的 `read()` 先查 `cache`，为空才 `await io.read()`，读完再赋 `cache`。冷启动时 `startScheduleClock` 的首拍和回前台（或 StrictMode 重挂）的一拍同时进来，两边都看到 `cache` 为空、各发一次读盘。快的那次读完，fold 的 `record()` 把新锚点写进 `cache` 并落盘；慢的那次这时才回来，把读盘时的旧副本赋给 `cache`。下一次 `record()` 在旧副本上合并再整份写出，fold 的锚点就没了。两次 `record()` 并发也一样：各自拿同一份旧 map 各加一条，后写的盖掉先写的。

## 解法

缓存 promise 而不是结果：`read()` 用 `map ??= load()`，所有调用方共享同一次读盘。`record()` 在当前 `map` 上链出合并后的 map 并替换 `map`，写盘排进一条 promise 链按记录顺序串行，最后一次写出的总是全部记录。凡是「先查缓存、await 之后再赋缓存」的异步读，都照这个办法改。
