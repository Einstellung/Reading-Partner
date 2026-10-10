# 520 页面里改不了 `__TAURI_INTERNALS__.invoke`

## 现象

pi-durable iOS 模拟器验收第二轮，经 sim bridge 在页面里执行 `window.__TAURI_INTERNALS__.invoke = wrapper`，想拦住 HTTP 插件或 `durable_sqlite_run` 让工具停在半路再杀进程。赋值不报错，包装函数一次也没被调到，回合照常跑完。

## 原因

Tauri 把 `window.__TAURI_INTERNALS__` 和它的 `invoke` 都定义成 `writable: false, configurable: false`。非严格模式下给只读属性赋值静默失败，`@tauri-apps/api/core` 的 `invoke` 每次读到的还是原函数。

## 解法

不在页面里拦 IPC。要让回合停在「工具调用已提交、结果未提交」那一刻，从宿主侧轮询 durable 库：`entries` 表里出现 `toolCall` 而还没有 `pi.tool-result` 时立刻 SIGKILL（验收用的 `killer.py`，30 ms 一轮）。工具要选真走网络的（手机 EPUB 课堂用 `find_paper`，约 3 s），纯内存的 `read_pages` 来不及杀。另：faux provider 的响应工厂只拿到 `messages`，看不到本轮给模型的工具表，faux 喊一个这张桌子没挂的工具（如手机课堂的 `search_papers`）会得到 `tool_unavailable`。
