# 668 OpenAlex 按 arXiv DOI 查到的 work，DOI 和日期是别的版本的，甚至是另一篇论文

## 现象

2026-10-22 实测。`/works/doi:10.48550/arXiv.1706.03762` 回的是「Attention Is All You Need」，但 `doi` 是 `10.65215/2q58a426`，`publication_date` 是 2025-08-23，`ids` 里没有 arXiv。`filter=doi:10.48550/arxiv.2501.12948` 回的是另一篇论文「Can Open Large Language Models Catch Vulnerabilities?」（DOI `10.4230/oasics.icpec.2025.4`），它的 locations 里挂着 `arxiv.org/abs/2501.12948`（DeepSeek-R1）。

## 原因

OpenAlex 把同一篇论文的各个版本并成一个 work，arXiv DOI 只是其中一个 location，`doi` 和 `publication_date` 取被选作主版本的那个。合并会出错，把一篇 arXiv 论文的 location 并到不相干的论文下面。

## 解法

按 arXiv DOI 查回来的 work 不按 DOI 对回去，用 `extractArxivId`（locations 里的 arxiv.org 链接或 arXiv DOI）对。用它的标题、摘要之前先和手上的 arXiv 标题比一遍（`match.ts` 的 `pickByTitle`），对不上就当没查到。日期一律用 arXiv id 的年月，不用 `publication_date`。客户端是 `openalex-client.ts` 的 `fetchOpenAlexWorksByArxiv` 和 `openAlexArxivHandle`，标题校验在调用方（docs/info/92 B 片）。
