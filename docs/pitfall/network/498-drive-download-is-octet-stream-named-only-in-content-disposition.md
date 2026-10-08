# Drive 下载直链回 application/octet-stream，文件名只在 Content-Disposition 里

## 现象

`drive.google.com/uc?export=download&id=<id>` 先 303 到 `drive.usercontent.google.com/download?id=<id>&export=download`，最终 200，`Content-Type: application/octet-stream`，PDF 也是这样，不是 `application/pdf`。文件名只出现在 `Content-Disposition: attachment; filename="Local-LLM-Karpathy-Thesis.pdf"`，URL 里只有 id。不存在的 id 回 404，正文是一页 HTML。

## 原因

Drive 的下载端点不按文件类型给 Content-Type。bindery 的 `FetchedBytes` 原来只带 `contentType`，宿主的 fetch 把其余响应头都丢了，适配器拿不到文件名。

## 解法

判 PDF 只看开头的 `%PDF` 四个字节，不看 Content-Type；以 `<` 开头或 `text/html` 的按页面拒收（登录、病毒扫描确认、文件不存在），不落文档。`FetchedBytes` 加了可选的 `contentDisposition`，`reading/ingest/live.ts` 的 fetch 把这个头传上来；新写宿主 fetch 的地方也要传，不传 Drive 的文件就只能叫 `Drive file <id>`。

*实测：2026-10-08*
