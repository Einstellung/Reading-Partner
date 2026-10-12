# OpenAI 上每个 durable 回合都以 no_model 结束

## 现象

iPad `.dev` 包设成 openai / gpt-6-luna、放好 ChatGPT 登录的 access token，门口发一句：turn-log 记 `start` 后 59 ms 就 `end reason error`、`error no_model`，没有发出请求，对话里只有读者那一句。同一进程里启动时的 `subagent` 回合（老的 `runAgentTurn` 路）用同一个模型两轮跑完 `done`，turn-log 里它的 provider 是 `openai-codex`。

## 原因

durable 回合的模型引用用的是 app 的 provider id（`settings.defaultProviderId`，这里是 `openai`）。`createAppModels`（`src/ai/durable-models.ts`）按 pi 的 `provider.id` 登记，而 app 的 `openai` 是 pi 的 `openai-codex`，于是 pico3 的 `rt.models.resolve({provider: "openai"})` 找不到模型，`generation` 直接 `failStep(no_model)`。只有 id 两边不一样的 provider 中招，目前只有 openai；Anthropic 一直验得过就是因为两边都叫 `anthropic`。

## 解法

`createAppModels` 在 app id 和 pi id 不同时把同一个 provider 再按 app id 登记一份（`Object.create` 后只改 `id`）。按 pi id 那份留着，因为 `Models.stream` 按模型自己的 `provider` 字段（`openai-codex`）分派。`tests/ai/durable-models.test.ts` 对每个 app provider id 查一次自己的模型。
