# 497 传了 fetchFn，fetchWithRetry 就不再按主机限速

## 现象

主题搜索的 arXiv 查询连着发，连续六个左右就被 429，而 `throttled-fetch.ts` 给 `export.arxiv.org` 定了每 3 秒一个请求，按说到不了限流线。

## 原因

`fetchWithRetry` 把「调用方传了 `fetchFn`」当成测试替身：`throttle = opts.throttle ?? (opts.fetchFn ? noThrottle : hostThrottle)`。宿主上的调用为了带 User-Agent 都传 `infoFetch`，于是整条路都走 `noThrottle`。`interactiveRetry(infoFetch)` 和 `PluginDeps.fetchFn: infoFetch` 都是这样。

## 解法

主题搜索的宿主接线（`topic-search/build-live.ts`）把 `infoFetch` 包成 `spacedFetch`：每次请求（含重试）先过一个按 `HOST_MIN_INTERVAL_MS` 建的 `createThrottle` 闸，arXiv 的查询梯子、看原文的 `fetchText` 和读 PDF 都走它。别处传 `infoFetch` 的调用也没有限速，要限速时照这个包一层，或传 `throttle`。
