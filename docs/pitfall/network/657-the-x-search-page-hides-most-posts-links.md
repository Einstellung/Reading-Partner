# 657 X 搜索页只显示帖子开头，多数帖子的链接不在那里

## 现象

2026-10-18 主题搜索的一次重跑，14 条帖子件有 12 条只读了帖子自己，`verify.status` 是 `self`，写总结时说「只读到了开头」。这些帖子实际都带 arXiv、GitHub 或文章链接。

## 原因

X 搜索页每条帖子只显示约 275 字，长帖和 X Article 后面截掉，截掉部分里的链接搜索页上没有。`x-read.json` 里帖子的 `links` 取自搜索页，所以多数是空的，排序和 `targetsOf` 拿不到论文和仓库。

看原文时程序确实经 permalink 读了全文，X 读法也交出了展开好的外链（`LinkSession.candidates`），但 `build-live.ts` 只回正文的节，`OpenedLink` 没有放链接的字段，链接在这一步被丢了。另外两处叠加：`targetsOf` 在第一份原文是帖子时不再加论文和仓库；写总结时每节截 1200 字，一节的 X Article 只剩开头。

## 解法

- `OpenedLink` 带 `links`：#1 那次读交出的候选，去掉 X 自己和本站导航，t.co 用读法已经展开的地址，不另发请求（`verify.ts` 的 `linksOut`，`open-link.ts`）。
- `readSelfPost` 把全文里的链接交回，`build-result.ts` 的 `readOriginals` 把它们变成原文目标，帖子之外每件最多读 `ORIGINALS_PER_ITEM`（2）份原文，论文先、仓库次、网页最后；读到非帖子的原文时 `original` 记它、状态是 `compared`。
- `targetsOf` 对帖子领头的件也加搜索页上就有的论文和仓库链接。
- 写总结时只有一节的 X 材料用整件的额度（`ITEM_MATERIAL_CHARS`），后面每还有一份材料给它留 1200 字。

以后从 X 搜索页取任何帖子内容（链接、数字、引用），先想到它可能只是开头，要全文得走 permalink。
