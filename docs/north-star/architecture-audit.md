# 架构审计的长期债（docs/37）

## 愿景

[37](../platform/37-结构与架构优化.md) 的架构审计做完了 A、B 两组共 22 项。C 组是「盯着，还不到时候」的几条：读代码就能验证现状，不需要单独立项讨论，本文只是把它摘一份放进北极星索引，好在改动相关目录前先看一眼。细节和触发线全在 37。

## 为什么现在不做

37 自己给每条都定了触发线（某个具体阈值、或出现某个新调用方），不是现在。每次重新量一遍数字都在涨，不代表要提前动手。

## 将来做时已知的事实

- `App.tsx` 2026-09-26 量到 1745 行（线 1600，已经越线三次）。
- `ui/components` 下过线的目录（线约 15，2026-09-26 量）：`phone` 39、`chat` 30、`reader` 25、`lumen` 25、`common` 24、`info` 16。
- 三份流式对话驱动正在收拢，但还没到一份：2026-09-25 的重构（`0017432f`）把 retell、info、手机课堂三处收拢到共同的 `useStreamingTurn`（`src/ui/components/chat/useStreamingTurn.ts`）和 `ai/turn-rows.ts`；阅读会话（`src/reading/session/use-call.ts`）仍是独立实现，只共用了行状态的算法（`applyRowChange`）。三份变两份。
- `loadPdfjs`（`src/fulltext/extract.ts`）没有提成独立 capability，触发线是 pdf.js 大版本升级或出现第三个消费者。
- `atomic-fs` 的 `readJson` 直调仍有 4 个调用点（`src/info/boxes/publish.ts`、`src/info/collect/pool-store.ts`），`readJsonOr` 0 个调用点，触发线是读失败策略真的要统一改的那天。
- 规则 1（`src` 下文件夹约 15 个文件就切子域）的例外——`ui/components/ui`、`ui/components/lib` 由 shadcn 和路径别名钉死，不适用——没有写进 CLAUDE.md。
- `docs/38-安全审阅.md` 没入库（分支 `docs/security-review` 未合并），但它记录的两条安全修复（sim-bridge 的 CSRF token、`saved-articles.json` 的 sanitize 绕过）本身都已经合入 `origin/main`；没入库的只是这份审阅记录。
- 记一笔不立项、也没人再核实是否已修的两个 bug：`mergeObject`（`src/platform/sync/merge/fields.ts`）用 `value[key] = ...` 写回，已确认没有 `__proto__` 守卫，远端一个 `__proto__` 键写进去不构成原型污染，但会在序列化时消失；设置面板开着时到达的 pull 被 defer，这个窗口里外壳的一次保存会把 pull 前的整份副本写回去（数据丢失，不是安全问题）——这一条本文没有重新核实。
