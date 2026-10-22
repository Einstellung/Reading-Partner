# Codex 上的单次调用从不读缓存：没有 prompt_cache_key

## 现象

2026-10-22 在 ChatGPT（Codex）上真跑一次专题调研，模型调用日志里每次都是 `cacheRead` 0、`cacheWrite` 0，连写稿重试那次也是：同一份约 5.6 万 token 的提示两分钟内发了第二遍，一个 token 都没从缓存读回来。

## 原因

Codex 的提示缓存按请求里的 `prompt_cache_key` 归堆，pi 的 openai-codex 拿 `sessionId` 当这个 key（`cacheRetention` 为 `"none"` 时不带）。`streamChat` 只按 `call-setup.ts` 的表把 `sessionId` 交给 pi，表里没有 `openai`，所以单次调用发出去的请求里根本没有 `prompt_cache_key`；`callModel` 每次 `newRunId()` 造的 id 到不了 Codex。durable 回合不受影响：pi-durable 给每个请求带对话自己的 id。Anthropic 按提示本身在 `cache_control` 断点上找前缀，不看 key。

## 解法

会把同一份提示再发一遍的调用给一个稳定的缓存 key：`AiCallOptions.cacheKey` → `StreamChatOptions.cacheKey` → `call-setup.ts` 的 `cacheKeySetup`，只对 Codex 生效，作为 pi 的 `sessionId` 发出去；`cacheRetention: "none"` 的调用不带。主题搜索和专题调研每个主题一个 key（`model-io.ts` 的 `topicCacheKey`，`topic-search:<id>`），一次 run 和一次更新的所有调用都带它。其他走 openai-responses 的 provider 也认这个 key，没量过，没加。
