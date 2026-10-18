# 658 不给 extractReadable 的 open 路由读不了任何普通网页

## 现象

2026-10-18 真网冒烟测主题搜索的「读帖子链到的原文」：论文、仓库、X、Drive 都读到了，帖子链到的博客和新闻页一篇都没读到，原因都是「the web adapter needs extractReadable」。单测是绿的。

## 原因

`LinkSessionDeps.extractReadable` 是可选的，`webAdapter`（`workshop/bindery/adapters.ts`）却离不开它，没有就抛错。主题搜索的 `openOriginal`（`open-link.ts`）只把 `fetch` 交给 `LinkSession`，`build-live.ts` 也没给，于是所有走通用网页那条路的链接都在适配器里失败；有专门读法或站点适配器的链接不经过它，所以只有普通网页坏。单测里的网页要么是假读法读的，要么 fetch 就失败了，走不到适配器。

## 解法

- `OpenOriginalDeps.extractReadable` 改成必填，`openOriginal` 交给 `LinkSession`；`build-live.ts` 照其他接线处的做法 `await loadExtractReadable()`（`workshop/extract/readable-lazy.ts`，不静态 import `readable.ts`）。
- 单测用假的抽取函数经 `openOriginal` 读一个普通网页，再读一个正文太短的页，确认交回的是门槛的原话。

以后新接一处 `LinkSession` 或 bindery 的 `readMaterial`，先确认 `extractReadable` 给了；可选字段没给不会在类型上报错。

2026-10-18 补：同一条路上，读到了不等于读到了正文。`webAdapter` 现在先用 `inspectFetchedPage` 看整页结构（拦截页标记、同意页表单、脚本壳、PDF 原始字节），抽出正文后短文再用 `inspectArticleText` 看它说的是不是验证页、同意页、找不到页面；拒收原因多了 `blocked`、`js-shell`、`wrong-content`、`error-page`、`too-large`、`rate-limited`，`unreachable` 带 HTTP 状态。`openOriginal` 把这些映射成 `read-failure.ts` 的 code 交回，站点直接给的 PDF 连字节一起交回，由 `readPage` 读文字层。单测在 `tests/info/topic-search/read-checks.test.ts`。
