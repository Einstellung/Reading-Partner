# 顶层 initializedPromise 永不 resolve

现象：`await view.initializedPromise` 或 `await reader.initializedPromise`（PDF 场景）永久挂起，后续代码全不执行。

原因：顶层的 Promise 创建后源码里从没 resolve 过；只有内部 view 级的（`view._view.initializedPromise` / `reader._primaryView.initializedPromise`）才 resolve。

解法：判断就绪用 `onInitialized` 回调（createView 的官方信号），别依赖任何 `.initializedPromise`。
