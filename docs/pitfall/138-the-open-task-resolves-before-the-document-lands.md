# 开文档的外层 task 在文档进 store 之前就 resolve 了

## 现象

引擎从直连换成 worker（`pdfium-worker-engine`）之后，页面照常渲染，顶栏却写着 "Couldn't be opened"、页码 "— / —"，控制台一条 `failed to open “demo.pdf”: the document did not open`。滚动容器的 `scrollHeight` 是 26055——那是没人接线、没套 fit-width 的原始高度，接上时是 11192。

## 原因

`openDocumentBuffer` 返回的是两层 task。外层在 dispatch 完 `startLoadingDocument` 之后当场 `resolve({ documentId, task: engineTask })`；文档进 store 是插件在内层 task settle 时 dispatch `setDocumentLoaded` 干的（`handleLoadTask`）。

直连引擎在主线程，内层任务在同一个微任务里就完成了，只 await 外层和 await 两层看不出区别。worker 差一个消息往返，于是 `getDocument(DOC_ID)` 返回 null，wireEngine 走坑 58 加的那条 `!doc()` 分支提前 return——页码、页尺寸缓存、布局与位置还原、`onReady` 全在那个 return 后面。插件自己订阅 store，所以页面照画，只有宿主这半没接上。

## 解法

两层都 await（`src/reading/engine/wire-engine.ts`）：

```ts
const issued = await dm?.openDocumentBuffer({ ... }).toPromise();
await issued?.task.toPromise().catch(() => {});
```

不用轮询等 `getDocument` 非空。`Task.wait` 的回调按注册顺序跑，插件的入库回调在 `openDocumentBuffer` 里就注册了，排在 `toPromise()` 之前，所以 await 到期时文档一定已经在 store 里。开失败仍由 `onDocumentError` 报（坑 58），`!doc()` 那条分支照留。
