# 记忆的回收与 concern

## 愿景

记忆的写入面在跑：观察、statement、dream 的归并、使用日志。缺的是另一半——能忘（`memory/gc`）、能判断一条 concern 是不是凉了、能被检索到。设计在 [48](../soul/48-记忆：观察与statement.md) 和 [58](../soul/58-蒸馏器与dream.md)。

## 为什么现在不做

48 自己把检索标成「待数据，先不做」，concern 的证据分档同样要等真实的量。回收和 pass 运行器改成 legion run 过去等 legion，现在不等了，还没排。

## 将来做时已知的事实

- `src/memory/gc` 不存在。规则在 58「回收：memory/gc」：水位到末尾、pass 成功、宽限期过了三条判据，动作由源登记表那一行给（删 / 截到尾部 / 降到本地冷层）。palace 每行的 `gc` 字段和 `DistillSource.afterEnd`（`src/memory/distill/sources.ts`）已经登记，只记录不动作。
- 同步范围内的文件不许直接删，对端会原样推回来（坑 [208](../pitfall/storage/208-file-deletion-does-not-survive-sync.md)）。两条路：走 `records` / `lines` 合并的加一行墓碑，或整文件退役走 `requestRemotePurge()`。永久豁免名单写在 58，要由测试盯着。
- dream 只做三阶段的第 2 步，`src/memory/dream/run.ts` 头注释写明。第 1 步付清蒸馏欠账（含 `threads-info-<date>.json` 这类读者不会「挂断」的源）和第 3 步回收都没有。
- pass 运行器还是 `arrears.ts` 那个 30 分钟扫描器。58 定它变成一种 legion run kind，挂进 `legion/schedule`，门槛常数不变。
- 蒸馏源已登记六种：`src/reading/distill/source.ts` 五种（`reading-thread`、`annotations`、`retell-thread`、`talk-thread`、`rehearsal-run`），加 `src/info/briefer/distill-source.ts` 一种。
- 水位只有游标那半边（`observations/meta.json`）。溯源账本（一 pass 一行：kind、单元、区间、产出的 observation id、时间）和它的三个读者（gc、stub、诊断）都没有。
- concern 只有 `kind`、`expectedIntervalDays`、`lapsed` 三个字段和手写入口，`src/memory/statements/types.ts` 上写着 Nothing computes `lapsed` yet。三档证据、跨渠道复现、新鲜度衰减、转正、author 改写限制、info 分拣消费全无。
- 48 的作废清单执行完毕，guessed profile 已退役（71c69b43），info 的 screen 和 triage 读 statement。`logUsage` 有一个生产调用点，`src/soul/turn.ts` 每轮记 shown；`cited`、`rejected` 两种 kind 在 `src/memory/usage/log.ts` 里定义了，没有任何调用点写它们。这份使用日志和它旁边的模型调用日志都是只写不读——文件自己的注释写明「nothing reads this log yet」。
- statement 层的六步检索管线没做，首次启动引导改成收集第一批 concern 也没做。
- dream 不读 `contradictedBy`：第二次矛盾会写成一条新 statement，旧的既不降权也不被取代。`src/memory/statements/types.ts` 的 `contradictedBy` 字段今天只被删除审计的证据链读（`reading/delete/pick.ts`），dream 侧（`src/memory/dream/`）不读。
- dream「考虑过、但当晚没能挂上任何 statement 的观察」按什么退出未做，退出窗口 K 也没定。`src/memory/dream/candidates.ts` 只给两份原始列表（未读过的观察、未被取代的 statement），不做筛选也不排序。
- dream 回放不按 gain×need 排序、不优先处理 correction：`candidates.ts` 的两份列表是磁盘上的事实顺序，不是排出来的。
- 门口对话（`listDoorUnits`，`src/soul/door.ts:87`）没有接进蒸馏：调用方需要调 `registerDistillSource`，但 `bootDomains`（`src/ui/components/common/useShellBootstrap.ts`）只注册了 info 和 reading 两侧的蒸馏源，没碰门口。
- `events-<topicId>.jsonl`（`src/platform/app/events.ts`）只增不减，没有轮转也没有直接删除的代码。
- 退役设备的 handoff 残留没有清理：`info-collector-legacy` 只在 palace 登记了一行（`src/palace/kinds.ts`），没有清理逻辑。58 自己盘点出的五处孤儿——线程配图目录、`threads-retell-<id>.json`/`threads-talk-<id>.json` 删记录时不级联、`deleteTopic` 不级联、按路径哈希命名的封面失败标记、条目级冲突副本——一个都没逐个核实修掉。
- info 日切缓存的 `pruneStaleDailyFiles` 有两个调用点（`src/info/briefer/reader.ts:237`、`src/info/program/live.ts:623`），58 认为重新分诊那条路径不会触发它，这个判断本身还没验证。
- sessionId 当 OpenAI 的 `prompt_cache_key` 没做：`src/ai/call-setup.ts` 只有注释说明这个想法，openai 这条 provider 没有对应的 `SetupRule`。见 [05](../soul/05-AI接入备忘.md)。

## 待定

58 转到 [61](../soul/61-palace与desk.md) 的三问：读者会不会回看 `threads-info-<date>.json` 的历史（会就并成月文件而不是删）；删原料还是留一份本地不同步的冷层；账本一行存什么。
