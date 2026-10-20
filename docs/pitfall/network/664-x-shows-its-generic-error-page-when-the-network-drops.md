# 断网后 X 搜索页显示「Something went wrong. Try reloading.」，被当成限流停了 X

## 现象

2026-10-20 主题搜索全流程实测（ts-7556db71）：网络断了约 2 分钟，X 的搜索页显示「Something went wrong. Try reloading.」，读取当场按限流停手（`rate-limited`），这一晚的 X 读取停了，限流还要跳过下一晚。同一段时间里重排、两次写稿和卢明开场话的模型调用全回「Connection error.」，慢段把 7 条只按本地相关度打分、没经模型判过的帖子交了出去，其中 3 条是主题 `avoid` 明确不要的 Google 推广。

## 原因

`search-page.ts` 的 `pageHalt` 把页面上的「Something went wrong」和「rate limit」「try again later」放在同一条限流正则里。这句是 X 的通用错误页，前端请求失败就显示，断网时也是它，不说明被限流。模型调用那边，`build-result.ts` 在重排失败时退回本地相关度的兜底分照样选件，`callModel` 本身不重试。

## 解法

搜索页只显示通用错误、没写明限流的，隔 5 秒重开同一页一次（算一页搜索页），还是这样才按限流停（`mayBeGenericError`，`x-reader.ts`）。重排失败的候选不再列件：结果文件记 `unjudged`，读到的留在 run 目录，主题下一次 run 并进来重判（docs/info/88「判不了」）。模型调用因网络失败时重试两次，隔 3 秒、6 秒（`model-io.ts` `retryingModel`）。
