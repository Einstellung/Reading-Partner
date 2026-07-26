# 交给 http 插件的 body 会被逐字节 JSON 化，26 MB 的上传要 400 MB

## 现象

iPad 上传一本 26 MB 的书到 Drive，WKWebView 的 content process 被 jetsam 杀掉，webview 重载，用户回到 app 初始页，正在读的书没了。

而且自己好不了：blob 没传上去，`hasBook` 一直是 false，下一趟 pass 又发同一个上传。引擎启动跑一趟、之后每 15s tick 有本地改动就跑一趟，`syncBooks` 是一趟里最后做的事。

## 原因

`@tauri-apps/plugin-http` 的 `dist-js/index.js` 第 68 行左右：

```js
const data = buffer.byteLength !== 0 ? Array.from(new Uint8Array(buffer)) : null;
```

body 变成一个每字节一个元素的 JS 数字数组，而且它是 `clientConfig` 对象的一个字段，不是 IPC 消息本身。`tauri/scripts/process-ipc-message-fn.js` 只对 `ArrayBuffer` / `ArrayBuffer.isView` / `Array.isArray` 的**消息本身**走 octet-stream 分支，其余一律 `JSON.stringify`。所以这个数字数组被序列化成 JSON 文本。

实测（真 PDF 字节，`public/demo.pdf` 1016315 字节）：3.535 个 JSON 字符/字节；均匀随机字节 3.571。26 MB 的书就是 ~92 MB 的 JSON 字符串，再 UTF-8 编码成 ~92 MB 的请求体。

数字数组本身在 JSC 里实测 10.6 字节/字节（Bun 就是 JSC，`heapUsed` 前后差）。一次请求同时活着的：原始 Uint8Array 1x + 插件内 Request/arrayBuffer 的拷贝 ~2x + 数字数组 10.6x + JSON 字符串 3.54x + UTF-8 body 3.54x ≈ 20x。26 MB × 20 = 500 MB 量级，实测设备上峰值约 400 MB。

下行没有这个问题：`plugin-fs` 的 `writeFile` 是 `invoke('plugin:fs|write_file', data, {...})`，`data` 就是消息本身，`ArrayBuffer.isView` 命中 octet-stream 分支；响应体也是 `fetch_read_body` 一段段回 ArrayBuffer。所以下载全程只有两份左右。

## 解法

大书上传改成分块 PUT（`src/platform/sync/driveBackend.ts` 的 `resumableUpload`）：开 resumable session，然后按 `Content-Range: bytes <start>-<end>/<total>` 一块块发，每块发完就释放。峰值只跟块大小有关，跟书多大无关。

块大小 1 MB（4 × 256 KB，Drive 要求非末块必须是 256 KB 的整数倍）。按上面 20x 算，一块的代价约 20 MB，加上常驻的整本书 26 MB，一次上传总共 ~46 MB。26 MB 的书是 26 个请求。

几条约束：

- 308 带的 `Range: bytes=0-<最后一个收到的字节>` 才是下一块的起点。按客户端自己发了多少来推进，服务端少收一段就是文件里一个洞，而且上传报成功、谁都不知道。没有 Range 头表示一个字节都没收到。
- 服务端连着说「我还是那些字节」要报错退出，否则就是永远重发。
- 每块单独重试（3 次），每块 60s 期限。整本书没有期限是因为 26 MB 在慢链路上本来就要几分钟；一块 1 MB 有了确定的大小，60s 相当于 17 KB/s 的地板，比这更慢这本书一趟里也传不完。
- 小于 5 MB 的书还是走 multipart 一次发完，没改。它的峰值同样是 20x，5 MB 就是 100 MB——在阈值以下，暂时不值得复杂化。

阅读路径顺带减了拷贝：`openInReader` 原本把同一本书 slice 五份（`bufferRef`、figures、fulltext、embedDoc，加上原始 bytes），但 `fulltext/extract.ts`、`figures/store.ts`、`figures/render.ts`、`EmbedPdfView` 的 `wireEngine` 每一个都自己 `buffer.slice(0)` 之后才交给 pdf.js / PDFium，谁都不会 detach 传进去的那份。改成共用一份，开一本 26 MB 的书从 5 份降到 2 份（原始 bytes + 共用 buffer），阅读期间常驻从 78 MB 降到 52 MB（共用 buffer + PDFium wasm 堆）。
