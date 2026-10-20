# X 搜索卡片的文字和页面自己的回答对不上：X Article 是空的，emoji 少了变体选择符

## 现象

2026-10-20 全流程实测（ts-full-7556-r2，旁听回答后的第一次 run）：X 读入 138 条，31 条（22%）是 X Article，`text` 为空、`truncated: true`，打分和重排都没有字可看，永久链接那步也不开 Article。普通帖子有的记了 `capture-mismatch`，作者相同，开头文字只差 emoji：页面是 `❤️♾`，回答是 `❤️♾️`。

## 原因

Article 的搜索卡片（认它靠 `article-cover-image`）读出的文字是空串；`withCaptured` 原先对 Article 保留 DOM 文字，回答里有的标题被丢掉。回答的 `article.article_results.result` 带 `rest_id`、`title`、`preview_text`（X 截好的正文开头，不做 HTML 转义）。

搜索页读出的文字里，一部分 emoji 后面的 U+FE0F 没有了，回答原样保留；`captureMismatch` 逐字比开头 40 字，于是报错。

## 解法

`graphql-post.ts` 的 `article` 加 `preview`。`withCaptured` 对回答里是 Article 的帖子，文字取帖子自己的话、标题、预览（前面已含的不重复），帖子上记 `articleId`、`articleTitle`，仍是 `truncated: true`。`captureMismatch` 比较前两边都去掉 U+FE0F/U+FE0E，再去链接、并空白、忽略大小写。
