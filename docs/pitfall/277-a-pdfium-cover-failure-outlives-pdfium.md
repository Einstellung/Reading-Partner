# 277 旧的 PDFium 封面失败记号会把 EPUB 封面挡掉一整天

## 现象

EPUB 封面在 Linux 上验过是好的，同一份代码装进 iPad 模拟器，书架上三本 EPUB 全是无封面卡片。`covers/` 目录里没有一张 `.jpg`，只有三个 `<hash>.failed.json`：

```
{ "reason": "open", "message": "Task rejected: {\"code\":3,\"message\":\"FPDF_LoadMemDocument failed\"}", "at": ... }
```

把这三个文件删掉再打开书架，两本有封面图的立刻出封面和 `dc:creator`，没有封面图的那本写下 `no-pages`。

## 原因

记号是上一版写的：那时封面只有 PDFium 一条路，EPUB 一律 `FPDF_LoadMemDocument failed`。`coverRetryDue` 只看时间，24 小时内的记号一律当数：升级到会读 EPUB 的版本之后，凡是一天之内看过书架的用户，他的 EPUB 还要再等一天才有封面。

## 解法

记号写下是哪个 reader 失败的（`CoverFailure.reader`：`pdfium` / `epub` / `file`）。没写 reader 的记号是「只有一个 reader 的版本」留下的，不算证据，`coverRetryDue` 直接放行重试一次。
