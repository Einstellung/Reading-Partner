# 打不开的 PDF 不会 reject，open 照常 resolve

## 现象

把 `public/demo.pdf` 换成 40kB 随机字节再打开：阅读区一片灰，没有报错、没有 toast、控制台什么都没有，状态栏永远停在 “Rendering…”。和加载慢完全分不出来。

`onInitialized` 里包着 `await openDocumentBuffer(...)` 的 try/catch 一次都没进去过。

## 原因

`document-manager` 的 `openDocumentBuffer` 返回的 Task 在解析失败时**照样 resolve**：`handleLoadTask` 把引擎 task 的失败分支交给 `handleLoadError`，自己既不 reject 也不重抛。

失败只留下两个痕迹：

- core store 里 `documents[id].status === "error"`，`error.reason.message` 是 `"FPDF_LoadMemDocument failed"`；
- `onDocumentError` 事件（`{documentId, message, code?, reason?}`）。

之后 `getDocument(id)` 返回 null，scroll / zoom / render 各插件都没东西可做，安静得和「还在加载」一模一样。宿主要是接着往下 wiring，最后还会 `onReady`，等于告诉外壳阅读器已经就绪。

## 解法

发起 open 之前就订阅 `onDocumentError` 把 message 记下来；`await` 回来后如果 `getDocument` 仍是 null，就把错误交给宿主并**停止 wiring**（别走到 `onReady`，那会把宿主刚设上的失败状态清掉）。宿主那边用现成的状态行 + toast 说人话：哪本书、打不开；引擎原文进控制台。
