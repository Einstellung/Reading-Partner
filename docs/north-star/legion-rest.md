# legion 的剩余部分

## 愿景

派活的地基已经立住：`src/legion/` 下 run、claim、schedule、execute、bell、ledger、subagent 齐了，palace 登记七行，四个调用方（`research-literature`、`tasking`、`collect`、`translate-book`）在跑。逐步的落地记录在 [55](../soul/55-legion.md) 的「现状与顺序」，本文只列还没做的。

## 为什么现在不做

地基是 2026-09-15 到 09-18 落的，剩下这几件不挡任何人用，排在产品面后面。

## 将来做时已知的事实

- session 到对话文件的单向投影没开始（[55](../soul/55-legion.md)「session」）。今天 `platform/app/session-fs.ts` 存的是运行时日志，soul 说的话另写进归属文件。
- effort 还不是一等维度（[25](../soul/25-子agent与上下文隔离.md)「分层思考」）。`SubagentDefinition.reasoning` 和 `providerId`/`modelId` 同在一个对象里，抬 effort 就得钉死一个具体模型；`runSubagent` 的入参里没有 effort。
- 25 的「留给以后」三条都没做：轮数用光时补一次收尾 turn、蒸馏 pass 的 `signal` 接上删除对话、简报生成挂子 agent。
- tasking 的三态判定（答上了 / 没答上 / 未判定时不释放 `idempotencyKey`）和同一问题当天去重没做（[63](../info/63-情报局：研究室、专项组与态势.md)）。
- translate 的跨设备那半没验：`translate-book` 走 `local` 档，「iPad 派、PC 跑」那条验收没跑过；取消通道接上了，界面上没有按钮调它。
- 老清单里的 mailbox `post` / `told` 和死信队列不再是欠账。55 把投递词表定成 queued / delivered / acked，`told` 是盒子的状态（`src/box/types.ts`）归 info；死信视图是 `src/legion/ledger/store.ts` 的 `deadLetters(day)`。
- 排在 legion 后面的四件现在能排了，一件没动：[59](../platform/59-同步：持有清单与裁决.md) 档 4 裁决层、[58](../soul/58-蒸馏器与dream.md) 的 pass 运行器变 run kind、`memory/gc`、concern 的 `lapsed`。见 [sync-tiers](./sync-tiers.md) 和 [memory-recycling](./memory-recycling.md)。
- schedule（`src/legion/schedule/schedule.ts`）只产出 wake 铃，不是任务队列：runner 里「同一 kind 本机同时只跑一个」，不同 kind 之间不拦，没有 FIFO 也没有跨 kind 按资源串行。
- claim 的能力标签只登记了一种：`WEBVIEW_FETCH`（`src/legion/claim/capabilities.ts`），GPU、常开这类标签还没人声明。
- 夜里 dream 仍是 `src/info/program/live.ts` 里 `amICollecting` + `isDreamDue` 直接触发，不经 schedule 的 wake 铃；analyst 角色也没注册，`registerRole`（`src/soul/roles.ts`）今天只有 info 的 secretary 一行（`src/info/briefer/role.ts`）。
- collect 没有拆成分析员和综合两个子 run，batch 续跑目前认的是第一个调用方。见 55 第 12 步、[71](../soul/71-soul.md)。
- ledger 没有重放：`housekeeping.ts` 和 `fold.ts` 只写 `briefHash`，没有校验哈希、也没有建一个回指原 run 的新 run。
- 死信没有界面：`deadLetters(day)`（`src/legion/ledger/store.ts`）在 src 里没有第二个调用点。
- bug：`run.brief` 随 `local` 档存放（session 不同步），选举中途换到另一台机器时，新机器读不到这份任务书，run 会失败。
- `BriefingView` 仍订阅 `info/boxes/pipeline`（`src/ui/components/info/use-info-home.ts`），没改成订阅 run 文件。
- 看门狗（`legion/execute/watchdog.ts`）有两个没定的点，写在 55「execute」：重试从原始消息重建 Agent，但轮次跨重试累加；`transformContext` 的截断不写回 Agent 的消息记录，每轮重算。

## 待定

ledger 的一行存不存任务书 payload（[55](../soul/55-legion.md)）。
