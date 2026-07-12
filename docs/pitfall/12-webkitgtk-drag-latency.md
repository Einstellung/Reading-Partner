# 拖选高亮时选区滞后于鼠标

现象：Linux 的 Tauri（WebKitGTK）里,用高亮笔拖选时选区明显追不上鼠标,像"线慢慢追鼠标"。用户 M2 验收时报告(2026-07-12)。同一套选区代码在 Chrome(headless 验证)和 Zotero iPad(WKWebView)上都没有这个现象。

怀疑（未验证,按嫌疑排序）：

1. WebKitGTK 在 Linux 某些驱动组合(尤其 NVIDIA)下 GPU 合成没生效或有 bug,重绘退回软件合成。这是 Tauri Linux 的已知痛点,嫌疑最大。
2. dev 模式开销(vite dev + debug 编译)。影响应该小。
3. 引擎 pointermove 里的 JS 几何计算属固有开销,毫秒级,正常不该被感知——除非叠加在 (1) 上被放大。

待验证实验：

- `WEBKIT_DISABLE_DMABUF_RENDERER=1 bun run tauri dev`
- `WEBKIT_DISABLE_COMPOSITING_MODE=1`
- release 构建对比 dev
- Chrome 里跑同一流程作基线对比

状态：体验优化,决定延后。先把基本功能(M3/M4)做完再回来修。修好后把根因和最终解法补进本文件。
