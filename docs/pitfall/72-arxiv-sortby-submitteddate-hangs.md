# arXiv 的 `sortBy=submittedDate` 不返回，限流又紧到六个请求就 429

## 现象

同一个 `export.arxiv.org/api/query` 查询，只差一个排序参数：

- `search_query=all:brain+evolution` — 0.75 秒 200，正常 Atom。
- 加上 `&sortBy=submittedDate&sortOrder=descending` — 25 秒没有响应，或者直接 429。

限流是另一回事，比文档写的紧得多：连着发六个请求（含前面那几次带排序的）就开始 `Rate exceeded.` 加 429，而且不是一次性的——之后连不带排序的普通查询也 429，31 秒才返回那个 429。同一个出口 IP 上要等几分钟才恢复。

## 原因

未查证。arXiv 的官方文档把 `sortBy` 列为受支持参数，但实测的表现是这条查询走了另一条代价高得多的路径（大概是排序要求物化整个结果集），超时或者被限流器直接掐掉。限流器只看出口 IP，不看你有没有带礼貌 UA。

## 解法

两条一起。

**排序参数不用。** 要"最新"就在 `search_query` 里下日期区间，让检索本身只返回那个窗口里的论文：

```
search_query=all:brain AND all:evolution AND submittedDate:[202501010000 TO 210001010000]
```

区间是闭区间、分钟精度，所以"某年以来"也得给个上界（`src/reading/prep/arxiv.ts` 用 2100）。这条路 0.75 秒的那档速度不变。

顺带一条结论：**别的库也不要按日期排序**。同一天实测 OpenAlex 的 `sort=publication_date:desc` 配全文检索 `search=brain evolution intelligence`，第一条是一篇讲德国经理人的管理学论文——日期排序把相关性排名整个扔了。四个库统一成"新"是过滤条件（arXiv 的 `submittedDate` 区间、OpenAlex 的 `from_publication_date`、S2 的 `year=2025-`、PubMed 的 `mindate/maxdate`），排序一律留给各库自己的相关性。

**限流按现成的来。** 主题检索走 `fetchWithRetry`（`src/reading/prep/http.ts`），它有按 host 的最小间隔（arXiv 3000ms）和 429 退避，终态 429 抛 `RateLimitError`。检索工具把这个抛出报成"arXiv 这一趟没答上来"，其余三个库照常返回——四个库并发扇出，一个挂掉不能带走整次检索。

*实测：2026-07-30*
