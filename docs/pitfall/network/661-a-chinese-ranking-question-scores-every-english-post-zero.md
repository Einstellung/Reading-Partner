# 中文的 ranking 问题当相关度地板，英文帖子全得 0，永久链接页一页不开

## 现象

2026-10-19 全流程实测中文主题「AI自主机制发现」（ts-7556db71，第一次 run）：X 六条线读入 305 条，277 条截断，永久链接页上限 40，一页都没开（`permalink: 0`）。截断的帖子全以搜索页那段开头进候选。同一次 run 的打分（`gatherCandidates`）照常，过地板 18、16、7、2、1、0 条。

## 原因

`run.ts` 的 `searchLines` 给读取线的地板用 `relevance: q.ranking.trim() || q.x`，而 `ranking` 是用户语言写的一句问题（「系统怎么自己决定下一轮做什么实验来检验或推翻假设？」）。`localRelevance` 按词重合算，中文问题和英文帖子没有共同的词，303/305 条得 0，全在 0.15 地板下。打分那边 `rank-pool.ts` 用的是 `plainQuery(q.x)`，两边各写各的，英文主题时看不出差别。

## 解法

两边共用 `rank-pool.ts` 的 `relevanceBasis(query, source)`：X 用 `plainQuery(q.x)`，论文源用 `arxiv` 词。用同一批帖子重放，按 X 查询有 223/305 条得 0、34 条截断帖过地板。另加报警：整次 run 满 60 条后九成以上得 0，进度文件记 `relevance-collapse`，进度行、源健康 `note`、background_status 都带警告，地板放不过任何帖子的线按页面顺序开前 3 条（`x-reader.ts` 的 `relevanceCollapse`、`permalinkPicks`）。`ranking` 只给重排的模型看。
