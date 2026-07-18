# Tauri http 插件 abort 后的 fire-and-forget，泄漏 "resource id N is invalid" 未捕获拒绝

现象：真机 Linux WebKitGTK，dev console 正常使用时冒出 `Unhandled Promise Rejection: The resource id 561019330 is invalid.`。出现在中断在途请求之后：watchdog 掐掉 AI 流、用户按停止、hangup、组件卸载。

原因（插件源码实锤，node_modules/@tauri-apps/plugin-http/dist-js/index.js，2.5.9）：请求的取消和 body 释放是 fire-and-forget。signal 的 `abort` 事件里，插件调 `plugin:http|fetch_cancel`（:104 定义，:113 触发 `void abort()`）和 `plugin:http|fetch_cancel_body`（:117-119 定义，:151-154 / :131 / :159 触发 `void dropBody()`），都用 `void` 丢弃返回的 promise。请求已经跑完、Rust 侧 resource 已经 drop 之后再触发 abort，这两个 invoke 就以 "The resource id N is invalid" 拒绝，而没有任何 JS promise 接着 catch——直接冒成 unhandledrejection。这些 promise 生在插件内部，调用方够不到。上游是 fire-and-forget 设计，本地无法从外层加 handler。

解法（两层）：

1. `src/tauri-fetch.ts` 的 `cleanTauriFetch` 包住插件 fetch：abort 时把面向调用方的拒绝统一成标准 `AbortError`（插件本来抛的是 `Error("Request cancelled")` 或 resource-id 串）。prep/http 和 AI fetch 桥都走它。这只修调用方能拿到的那条 promise，管不到内部 `void` 掉的两个 invoke。
2. `src/main.tsx` dev-only 的 `unhandledrejection` 网：只吞 `/resource id \d+ is invalid/i` 这条，debug 级别记一次，其余原样放行。正则锚在插件原话上，别的应用拒绝匹配不到。这是唯一能盖住内部 promise 的地方。

关联坑：15（同一个 http 插件）。
