# Semantic Scholar 的引用边：`data` 会是 `null`，`year=` 会被静默忽略

## 现象

两条都在 `/paper/{id}/references` 和 `/paper/{id}/citations` 上。

**一、`data: null`。** 文档说 `data` 是数组。实测 `DOI:10.1073/pnas.0611396104`（Herculano-Houzel 2007，一篇很正常的 PNAS 论文）的 `/references`，HTTP 200，body 是：

```json
{"data": null, "citingPaperInfo": {"openAccessPdf": {..., "disclaimer": "Notice: The following paper fields have been elided by the publisher: {'references'} ..."}}}
```

出版商把参考文献字段抽掉了，S2 于是回 `null` 而不是 `[]`。照文档写 `body.data.map(...)` 在这篇论文上直接抛 TypeError。

**二、`year=` 参数被静默忽略。** `/citations` 上带 `year=1990-1995` 查 `ARXIV:1706.03762`（Transformer 那篇，2017 年发表，不可能有 1990-1995 年的引用者），HTTP 200，返回的是三篇 2026 年的论文——和完全不带 `year=` 的结果一模一样。没有报错，`warninglist` 里也没有提示。这两个端点同样不接受任何排序参数。

## 原因

第一条是出版商的字段级授权限制，S2 用 `null` 表达"这个字段我不能给你"，和"这篇论文没有参考文献"不可区分（只有 `citingPaperInfo.openAccessPdf.disclaimer` 里那段文字能区分）。

第二条未查证：`year` 是 `/paper/search` 上的合法过滤器，这两个端点大概复用了同一套参数解析但没接过滤逻辑。

## 解法

**`data` 当成可能为 null 来解析，并且空结果要能往下降级。** `src/reading/papers/s2.ts` 的 `parseS2Edges` 用 `Array.isArray` 判断，非数组一律当成"S2 给不出边"。上层 `walkCitations`（`citations.ts`）在拿到空结果时**继续试下一个库**，不只在报错时才降级——因为"S2 返回空"最常见的原因就是这条字段被抽掉了，而 OpenAlex 那边有这篇论文的 `referenced_works`。

**别发 `year=`，过滤和排序都在本地做。** 这就决定了两个方向各由哪个库领跑：

- 往后（`references`）：S2 领跑。一次请求 `limit=500` 能把整份参考文献列表拿全（参考文献数量有上界），所以本地排序是对**完整集合**排的。OpenAlex 是降级路径，用来接上面那个被抽掉字段的情况。
- 往前（`citations`）：OpenAlex 领跑，因为它是两个库里**唯一**能在服务端同时按日期过滤（`from_publication_date`）和按引用数排序（`sort=cited_by_count:desc`）的。S2 只能拉回任意一页，本地排完只是个样本——所以 `WalkResult.sampled` 要标出来，结果文本里明说这不是全集的前几名。

顺带一条：往前那个方向**必须**排序加截断。实测种子 W2033231119（同一篇 PNAS）有 423 个引用者，加 `from_publication_date:2024-01-01` 剩 44 个；按引用数排序返回的第一条是 2024 年被引 45 次的 *Unraveling mechanisms of human brain evolution*，而按日期排序返回的前五条全是 2026 年、引用数全为 0 的论文。日期排序在这个方向上等于返回噪音。（这和 `docs/pitfall/72` 里"新是过滤、排序留给相关性"不冲突：`cites:` 过滤出来的是一个集合，本来就没有相关性排名可保。）

**匿名额度很薄。** 实测间隔 12-15 秒的单个请求也会连续 429，重试六次都没过。所以 `walkCitations` 用 `INTERACTIVE_RETRY`（一次重试、短退避）快速失败并报出"这个库没答上来"，而不是让读者等着退避。

*实测：2026-07-30*
