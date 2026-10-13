# Codex 通道的 web_search 不给引文

## 现象

`web_search` 走 ChatGPT 订阅的 Codex 端点（`chatgpt.com/backend-api/codex/responses`），回答里没有一个 `[n]`，来源列表是二三十条搜索候选，回答真正用到的那页常常不在里面。

## 原因

2026-10-13 实测：`output_text` 的 `annotations` 为空，没有 `response.output_text.annotation.added` 事件，`response.completed` 的 `response.output` 是空数组。来源只能从 `web_search_call.action.sources` 拿，那是搜索返回的候选，不是引用。

## 解法

Codex 请求的 `instructions` 要求模型把用到的页面写成行内 markdown 链接；没有 annotation 时，从回答里抽出这些链接排在来源列表前面，候选跟在后面（`src/websearch/request.ts` 的 `readResponsesStream`）。
