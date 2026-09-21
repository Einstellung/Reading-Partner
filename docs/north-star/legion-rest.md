# legion 的剩余部分

## 愿景

派活的地基已经立住：`src/legion/` 下 run、claim、schedule、execute、bell、ledger、subagent 齐了，palace 登记七行，四个调用方（`research-literature`、`tasking`、`collect`、`translate-book`）在跑。逐步的落地记录在 [55](../55-legion.md) 的「现状与顺序」，本文只列还没做的。

## 为什么现在不做

地基是 2026-09-15 到 09-18 落的，剩下这几件不挡任何人用，排在产品面后面。

## 将来做时已知的事实

- session 到对话文件的单向投影没开始（[55](../55-legion.md)「session」）。今天 `platform/app/session-fs.ts` 存的是运行时日志，soul 说的话另写进归属文件。
- effort 还不是一等维度（[25](../25-子agent与上下文隔离.md)「分层思考」）。`SubagentDefinition.reasoning` 和 `providerId`/`modelId` 同在一个对象里，抬 effort 就得钉死一个具体模型；`runSubagent` 的入参里没有 effort。
- 25 的「留给以后」三条都没做：轮数用光时补一次收尾 turn、蒸馏 pass 的 `signal` 接上删除对话、简报生成挂子 agent。
- tasking 的三态判定（答上了 / 没答上 / 未判定时不释放 `idempotencyKey`）和同一问题当天去重没做（[63](../63-情报局：研究室、专项组与态势.md)）。
- translate 的跨设备那半没验：`translate-book` 走 `local` 档，「iPad 派、PC 跑」那条验收没跑过；取消通道接上了，界面上没有按钮调它。
- 老清单里的 mailbox `post` / `told` 和死信队列不再是欠账。55 把投递词表定成 queued / delivered / acked，`told` 是盒子的状态（`src/box/types.ts`）归 info；死信视图是 `src/legion/ledger/store.ts` 的 `deadLetters(day)`。
- 排在 legion 后面的四件现在能排了，一件没动：[59](../59-同步：持有清单与裁决.md) 档 4 裁决层、[58](../58-蒸馏器与dream.md) 的 pass 运行器变 run kind、`memory/gc`、concern 的 `lapsed`。见 [sync-tiers](./sync-tiers.md) 和 [memory-recycling](./memory-recycling.md)。

## 待定

ledger 的一行存不存任务书 payload（[55](../55-legion.md)）。
