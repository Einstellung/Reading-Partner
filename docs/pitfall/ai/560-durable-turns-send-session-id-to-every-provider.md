# durable 回合给每个供应商都带 sessionId，不看 call-setup 的表

## 现象

`src/ai/call-setup.ts` 那张表只给 OpenCode（`x-opencode-session`）和 Fireworks（pi 的 `sessionId`）带会话标识，注释写明 OpenAI 和走 openai-responses 的模型故意不带。搬上 pi-durable 后，回合发出去的请求在 Codex 上带了 `session-id`、`x-client-request-id` 头和 `prompt_cache_key`，openai-responses 的模型带了 `x-session-id` 一组头。

## 原因

durable 回合不走 `streamChat`，那张表管不到。pi-durable 的 `GenerationTask` 每次请求都把对话自己的 `pi.provider` 文档里的 uuidv7 当 `sessionId` 交给 `models.streamSimple`，不分供应商；pi-ai 1.1.0 的各家 API 按 `sessionId` 自己出头：OpenCode 两家由 `withOpenCodeSessionHeader` 补 `x-opencode-session`，带 `sendSessionAffinityHeaders` 的模型出亲和头，Codex 和 openai-responses 无条件出。同一线程一个对话，id 跨轮、跨回合、跨重启不变；后台运行和子对话各是新对话，各一个新 id；整库换代后对话重建，id 换新。0.23.2 起书的回合就是这样。

## 解法

不改：这是 pi 自己的标准路径，OpenCode 缺头会 400，现在由 pi-ai 补上。`tests/legion/durable/session-id.test.ts` 经真 provider 对象和假 fetch 钉住出站请求上的头和 `prompt_cache_key`。改 call-setup 的表不会影响 durable 回合，要动回合的会话标识得在 `durable-models.ts` 的 `appProvider` 里改 options。
