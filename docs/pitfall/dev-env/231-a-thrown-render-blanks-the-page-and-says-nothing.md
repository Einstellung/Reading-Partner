# 231 探针页渲染时抛异常，图是一整片背景色，命令行一个字都不说

## 现象

CDP 拍出来的 PNG 是均匀的 `#faf9f5`，连顶栏都没有。`document.body.innerHTML` 只剩一个空的 `<div id="root">`。但资源面板里 CSS、JS、`demo.pdf`、`pdfium.wasm` 全是 200——东西都到了，页面就是空的。看上去像挂载没发生，于是往 fetch、模块顺序、`--user-data-dir` 上查了好几轮。

## 原因

挂载发生过。React 18 在渲染或提交阶段吃到未捕获的异常会卸掉整棵根树，留下的正是那个空 `#root`，所以「没挂载」和「挂载后炸了」在 DOM 上长得一样。这次是探针页自己写错：读了 `ViewStats` 上不存在的 `zoom` 字段，`undefined.toFixed()` 抛在渲染里。无头 Chrome 不打印页面异常，截图脚本也不订阅，于是没有任何一处提到出过错。坑 221 记的是同一个症状的另一个成因。

## 解法

截图脚本一律先 `Runtime.enable`，再把 `Runtime.exceptionThrown` 和 `type === "error"` 的 `Runtime.consoleAPICalled` 打到 stdout。这两行加上之后，上面那次从「查了三轮」变成一句话：

```
ERR ["TypeError: Cannot read properties of undefined (reading 'toFixed')"]
```

另外：探针页读的每个字段都按真实类型来（`ViewStats` 有 `pageIndex`/`pagesCount`/`pageLabel`，没有 `zoom`），别照着引擎内部的 `EmbedViewStats` 写。
