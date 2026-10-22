# Codex 目录里有的模型，ChatGPT 账号不一定能用：gpt-5.5

## 现象

2026-10-22 设备默认模型是 `gpt-5.5`（provider `openai`，即 pi 的 openai-codex），专题调研第一次 run 的重排一调就失败，后端回 `{"detail":"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."}`。设置里照样能选它，`enforceKnownModel` 也不换掉它；run 的结果 `empty`、`unjudged` 60 条，书架上什么都没出，原因只在结果文件的 `unjudged.why` 里。

## 原因

模型清单是 pi-ai 1.1.0 自带的目录（`@earendil-works/pi-ai/dist/providers/data/openai-codex.json` 的 `chat:gpt-5.5`），应用里 `getModels` / `isSelectableModel` / `defaultModelFor` 都直接读它，`enforceKnownModel` 只查 id 在不在目录里。目录说「Codex 后端有这个模型」，不说哪种账号能用；拒不拒是后端按账号定的，只有真调一次才知道。

## 解法

失败要看得见：`ai/provider-failure.ts` 的 `modelCallFailure` 把「模型不被支持」认出来，run 关闭时记进书架的 `stalls` 并放盒子条目（docs/info/88「判不了」）。目录本身没改：不改 node_modules；要从选单里拿掉，在 `ai/providers.ts` 给 `openai` 的 `getModels` 套一层已知被 ChatGPT 账号拒掉的 id 名单，`enforceKnownModel` 会把存着的默认模型换成目录里窗口最大的那个并提示一句。这一步等用户定。
