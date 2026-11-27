# legion 的剩余部分

## 愿景

派活的地基已经立住：`src/legion/` 下 run、schedule、runner、durable、bell、ledger、subagent 齐了，palace 登记七行，七个 worker（`research-literature`、`tasking`、`collect`、`translate-book`、`adjudicate-prose`、`ingest-url`、`meals-photos`）在跑，都经 `registerWorker` 登记。逐步的落地记录在 [55](../soul/55-legion.md) 的「现状与顺序」，本文只列还没做的。

## 为什么现在不做

地基是 2026-09-15 到 09-18 落的，剩下这几件不挡任何人用，排在产品面后面。

## 将来做时已知的事实

- 回合运行时的数据在每设备一个的 durable 库里（[87](../soul/87-回合运行时迁到pi-durable.md)），不同步、整库换代；soul 说的话落地时另写进归属文件，库里的内容不回投到对话文件。
- effort 还不是一等维度（[25](../soul/25-子agent与上下文隔离.md)「分层思考」）。`SubagentDefinition.reasoning` 和 `providerId`/`modelId` 同在一个对象里，抬 effort 就得钉死一个具体模型；`runSubagent` 的入参里没有 effort。
- 25 的「留给以后」三条都没做：轮数用光时补一次收尾 turn、蒸馏 pass 的 `signal` 接上删除对话、简报生成挂子 agent。
- tasking 的三态判定（答上了 / 没答上 / 未判定时不释放 `idempotencyKey`）和同一问题当天去重没做（[63](../info/63-情报局：研究室、专项组与态势.md)）。
- translate 的跨设备那半没验：`translate-book` 走 `local` 档，「iPad 派、PC 跑」那条验收没跑过；取消通道接上了，界面上没有按钮调它。
- 老清单里的 mailbox `post` / `told` 和死信队列不再是欠账。55 把投递词表定成 queued / delivered / acked，`told` 是盒子的状态（`src/box/types.ts`）归 info；死信视图是 `src/legion/ledger/store.ts` 的 `deadLetters(day)`。
- schedule（`src/legion/schedule/schedule.ts`）只产出 wake 铃，不是任务队列：runner 里「同一 kind 本机同时只跑一个」，不同 kind 之间不拦，没有 FIFO 也没有跨 kind 按资源串行。
- `legion/claim`（选举和能力标签）2026-11 删了：所有活都不再选机器。将来真有只能在某类机器上跑的 `synced` 活（GPU），要重新定怎么派。
- schedule 不选机器，每台到点的设备各摇一次 wake 铃；现在没有登记任何 schedule，真要用时先定跨设备怎么去重。
- 夜里 dream 是 `src/presence/daily.ts` 的每日 round 直接触发（当晚第一台打开的设备跑，`dream-runs/` 去重，见 [48](../soul/48-记忆：观察与statement.md)），不经 schedule 的 wake 铃；analyst 角色也没注册，`registerRole`（`src/soul/roles.ts`）今天只有三餐的 `meals` 角色一行（`src/meals/conversation/role.ts`）。
- collect 没有拆成分析员和综合两个子 run，batch 续跑目前认的是第一个调用方。见 55 第 12 步、[71](../soul/71-soul.md)。
- ledger 没有重放：`housekeeping.ts` 和 `fold.ts` 只写 `briefHash`，没有校验哈希、也没有建一个回指原 run 的新 run。折叠只写行；run 文件的回收归 housekeeper 的 `legion-run-files` marker（[80](../platform/80-回收：retention、garbage marker 与 housekeeper.md)）。
- 死信没有界面：`deadLetters(day)`（`src/legion/ledger/store.ts`）在 src 里没有第二个调用点。
- bug：`run.brief` 随 `local` 档存放（不同步），`synced` 的 run 被另一台设备接走时，那台读不到这份任务书，run 会失败（裁决 run 的任务书是冲突副本路径，不受影响）。
- `BriefingView` 仍订阅 `info/boxes/pipeline`（`src/ui/components/info/use-info-home.ts`），没改成订阅 run 文件。

## 待定

ledger 的一行存不存任务书 payload（[55](../soul/55-legion.md)）。
