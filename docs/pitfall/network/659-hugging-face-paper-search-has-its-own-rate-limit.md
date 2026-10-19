# 659 Hugging Face 的论文搜索单独限流，日期也不是 arXiv 第一版

## 现象

主题搜索接 `huggingface.co/api/papers/search` 时三件事和文档或直觉不符：Hub 其他 API 正常时论文搜索被 429；结果里的 `paper.publishedAt` 有的比 arXiv id 的年月晚好几个月；加 `sort`、`since`、`skip` 结果不变。

## 原因

论文搜索有自己的计数桶，每 5 分钟 50 次，只写在回答头里，和 Hub 别的 API 不共用。`publishedAt` 有时是 Hub 收录那天，不是 arXiv 第一版的日期。这个端点只认 `q` 和 `limit`（最多 120），按相关度排、不分日期。

## 解法

闸里给论文搜索单开一道（`HF_PAPER_SEARCH_LANE`，`gateKeyOf`），间隔 6 秒、冷却单独记，`huggingface.co` 其余请求 1 秒一个。日期用 arXiv id 的年月校正（`huggingface.ts` `paperDay`），时间窗在本地筛，一次要满 120 篇。
