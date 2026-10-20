# DevTools 的 Network 域替页面留着每一张读过的页图，Playwright 量出来的"内存越读越大"是它

## 现象

Playwright 驱动无头 Chromium 竖向连续读 PDF，渲染进程 RSS 从第 20 页的 870MB 一路涨到第 100 页的 1048MB。memory-infra 分类里涨的只有 `partition_alloc/partitions/buffer`：15MB → 201MB，到第 120 页前后停在 210MB 不再动。涨的量是"引擎累计产出的 PNG 字节数"的约 1.4 倍，关掉 TilingLayer 或 RenderLayer 就按各自的产出量等比变小，关 SelectionLayer、AnnotationLayer 不变；强制主线程和所有 worker GC 也不掉。

## 原因

不是阅读器的泄漏，是测量工具本身。Playwright 给每个页面的 DevTools 会话都开了 Network 域，Blink 的 InspectorNetworkAgent 会把每次加载的响应体留一份给 DevTools 看，`blob:` URL 的 `<img>` 和 `fetch` 也算，上限是它默认的总缓冲（约 200MB），所以先线性涨、后封顶。

隔离实验（空白页里造 150 张约 0.22MB 的 PNG blob，共 33MB）：

| 做法 | Network 域开 | Network 域关 |
| --- | --- | --- |
| 只造 blob（worker 里 `convertToBlob` 或主线程 `new Blob`） | 0.6–2.2MB | — |
| blob 走 `createObjectURL` + revoke，不加载 | 0.6MB | — |
| `blob.arrayBuffer()` / `FileReader` 读 | 0.6MB | — |
| `<img src=blob:>` 加载后 revoke、移除（挂不挂 DOM、清不清 src 都一样） | 49.7MB | 0.6MB |
| `fetch(blob:)` | 48–49MB | 0.6MB |
| `<img src=data:>` | 98.4MB | — |

表里是渲染进程 buffer 分区读数。在自己的 CDP 会话上 `Network.disable` 没用：每个会话各有一个 agent，Playwright 那个照样在存。

真实阅读器去掉 Network 域后读到第 200 页：buffer 分区 11–15MB 不动，`[anon:partition_alloc]` 105→107MB，RSS 837→867MB；同一轮开着 Network 域是 870→1052MB。

## 解法

量内存不要用 Playwright 的页面会话：自己起 headless shell（`--remote-debugging-port=0`），裸 CDP 连上去，只开 Page、Runtime、Input、Fetch（Fetch 拦截喂 PDF，不存响应体）和浏览器级的 Tracing。要复现旧读数就在页面会话上发一次 `Network.enable`。脚本是 scratchpad 里的 `memtrace-raw.mjs`。Playwright 量帧间隔、输入延迟照样能用，那些和响应体缓冲无关。
