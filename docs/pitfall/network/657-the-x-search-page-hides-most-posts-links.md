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

## 永久链接页读过的帖子也丢链接

2026-10-18 同日另一次端到端：X 读取阶段已经为截断的帖子开过永久链接页，`x-reader.ts` 只取了全文，页上的锚点丢掉，帖子标成 `truncated: false`。看原文时 `readSelfPost` 只为截断的帖子再开页，这些帖子不再打开，`links` 一直是空的。一条全文写着论文和代码地址、一条带 goo.gle 短链，都按 `self` 只读了帖子。还有一条搜索页上没截断的帖子，文字里写着短链，底下没有 t.co 锚点，`links` 也是空的。

解法：
- 读永久链接页时取这条帖子自己 article 的外链（`permalink.ts` 的 `outboundLinks`，锚点带 `quoted`，引用帖里的不取），并进 `post.links`，t.co 照原来的办法展开；链接写进进度文件的 `permalink` 步，续跑不丢，旧进度文件没有这个字段照常读。
- 帖子文字里写出的链接在打分和看原文时从文字取（`text-links.ts` 的 `postLinksOut`），旧的 `x-read.json` 也补得上。X 的显示地址读到了隐藏部分时（`https://` 在场）省略号前就是完整地址；不带协议又以省略号结尾的只是开头，不取。
- `readSelfPost` 交回的链接是这些加上全文页的，和搜索页的链接一样按论文、仓库、网页的顺序补读，最多 2 份。

以后从 X 搜索页取任何帖子内容（链接、数字、引用），先想到它可能只是开头，要全文得走 permalink；从 permalink 取了全文，也要把链接一起带走。
