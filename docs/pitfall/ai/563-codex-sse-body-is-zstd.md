# Codex 的 SSE 请求体是 zstd 压缩的

## 现象

测试里假 `fetch` 记下请求体再 `JSON.parse`，Codex（`openai`）的回合报 `JSON Parse error: Unexpected token '('`，durable 回合以 `model_error` 结算，假 fetch 一次也没记上。

## 原因

pi-ai 1.1.0 的 `openai-codex-responses` 走 SSE 时先 `compressRequestBodyZstd`，加 `content-encoding: zstd` 再发；WebSocket 那条发的是原文。假 fetch 里的解析抛出，被 pi-ai 当成 provider 错误。

## 解法

按 `content-encoding` 先 `Bun.zstdDecompressSync` 再解析，见 `tests/legion/durable/session-id.test.ts` 的 `network()`。
