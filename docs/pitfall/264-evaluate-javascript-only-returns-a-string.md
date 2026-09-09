# WebKit2 的 evaluate_javascript 只认得回字符串，回 Promise 或 null 直接报错

现象：用 python 的 WebKit2 绑定（`gi`）在 xvfb 里跑无头页面验渲染，脚本本身跑对了，`evaluate_javascript_finish` 抛 `WebKitJavascriptError: Unsupported result type (601)`，看起来像页面出错。

原因：报错说的是脚本最后一个表达式的值，不是脚本有没有跑。`window.__run().then(...)` 的值是 Promise，`window.__result || null` 在还没算完时是 null，两种都不在绑定能转的类型里。脚本其实已经执行了。

解法：每段注进去的 JS 都以一个字符串收尾——起跑那段结尾写 `'started';`，轮询那段写 `String(window.__result || '')`。异步结果挂在 `window` 上，用 `GLib.timeout_add` 轮询取，别指望 `evaluate_javascript` 等 Promise。可跑的例子在 `scratchpad/epub-figures/runner.py`。
