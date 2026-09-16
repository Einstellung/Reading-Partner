# OSS Insight 的 trending 接口回空表，原因写在旁边的 data_quality 里

## 现象

`GET https://api.ossinsight.io/v1/trends/repos/?period=past_24_hours&language=Python` 返回 200，`data.rows` 是 `[]`，`data.columns` 也是 `[]`。换 `past_week`、`past_month`、不带 language 都一样。照文档写的解析器把它当成「今天没有」，源健康全绿，条目零。

响应里多了一个文档没写的顶层字段（2026-09-13 实测原文）：

```json
"data_quality": {
  "status": "unavailable",
  "metric": "github_event_derived_ranking",
  "source": "github_public_events_firehose",
  "unavailable_since": "2026-03-01",
  "reason": "This ranking is ordered by recent star/PR/issue event counts, and our capture of those events fell to roughly 0.3% of baseline, so the ordering would be noise. An empty result here means the metric cannot be computed, not that there are no matching repositories.",
  "alternative": "Totals synced directly from GitHub remain accurate: use /gh/repos/{owner}/{repo} for star and fork counts, or /v1/collections/{id}/repos for collection membership.",
  "docs": "https://ossinsight.io/docs/data-quality"
}
```

## 原因

trending 榜按近期 star / PR / issue 事件数排序，OSS Insight 从 2026-03-01 起对 GitHub 公开事件流的采集只剩基线的 0.3%，排序成了噪声，于是接口宁可回空。空表不是「没有匹配的仓库」，是「这个指标算不出来」。OpenAPI 文档（`api.ossinsight.io/docs/json`）里没有 `data_quality` 这个字段，只有靠实际请求才看得到。

顺带两条同一次实测的：行里所有值都是字符串（`"stars": "395"`、`"pushes": ""`），`stars` / `forks` 是时间窗内的增量不是总数；`/gh/repos/{owner}/{repo}` 是 GitHub 仓库对象的直接转发，只有总数没有排名。

## 解法

`github.ts` 的 trending 分支：`rows` 为空且 `data_quality.status === "unavailable"` 就抛错，错误信息带 `unavailable_since` 和 `reason`，让 collectAll 记进源健康，源列表上看得见「为什么没条目」。`rows` 为空但没有这个字段才是真的空。

在 OSS Insight 恢复之前，GitHub 的发现只有 search 模式（`created:>` 找新仓库）能用；核验信号照旧走 OpenDigger。
