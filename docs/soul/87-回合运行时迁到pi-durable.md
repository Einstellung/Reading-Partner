# 回合运行时迁到 pi-durable

> 2026-10-10 定案。依据是 [pi-durable spike](../research/pi-durable-spike.md) 两轮实测（第 8 节是 SQLite 后端）和坑 495、511 到 515。上游：[55](./55-legion.md) 是 run、bell 与 execute，[71](./71-soul.md) 是 soul 与对话按归属存，[72](./72-聊天的可见性与steer.md) 是 steer 与停止，[25](./25-子agent与上下文隔离.md) 是子 agent。
>
> 取代关系：迁移做完时，本文取代 55 的「execute」「session」两节、71「对话按归属存」里 session 那一段、25「契约」一节里隔离的实现（契约本身、诚实失败、brief 的形状不变）。每阶段落地时在对应文档里改一句指向本文。

---

## 定下的

回合运行时整层换成 `@earendil-works/pi-durable`，版本钉精确号 `1.1.0`。手搓的 lane、session、恢复那层反复出回答不了、中途断掉，补丁打不完。最后 pi-agent-core 升 1.1.0 后整个删掉：1.1.0 只剩内存版 `Agent`，我们不用。

pi-durable 只管在途。对话的存档仍是 `threads-*.json` 等对话文件，回合结束落进去，经现有同步到别的设备。跨设备仍走同步和 legion（claim、run 文件）。

## 存储与 Harness

每台设备一个长期共用的库、一个 Harness。soul、各本书的阅读对话、info、三餐、子 agent 都是这个 Harness 里的对话，并行和对话之间协作由 Harness 内建。

| 项 | 做法 |
|---|---|
| 后端 | pi-durable 的 SQLite 存储核心（`/storage/sqlite`），库在 Rust 侧：`src-tauri/src/durable_sqlite.rs`（rusqlite bundled，WAL、`synchronous = NORMAL`）；前端 `src/platform/app/durable-sqlite.ts` 实现 `SqliteDatabase` 门面 |
| 位置 | AppData `durable/turns-<代号>.sqlite`，代号是创建时刻，取最新那个 |
| 同步 | palace 登记一行 `durable`，sync `local`：不进同步范围、不进 holdings、不进云同步目录 |
| 删除 | 不按条删；大小靠换代（见下） |
| settings | 不让 Harness 重试请求（pi-ai 自己那层重试保留）、`compaction.enabled: false`、`toolExecution: "sequential"`，同今天；`progress.partialIntervalMs` 100；`stream.timeoutMs` 见「停摆」 |
| models | 现有 `ai/` 的 provider、鉴权、请求改写接到 pi-ai 的 `createModels()` |

一个对话对应一条线程。对话建出来时用 `init` 写一份 `rp.thread` 文档（place、`bookKey`、`threadId`，即今天的 BoxOrigin）；session 级文档 `rp.conversations` 是线程到对话 id 的表。换代后表是空的，对话在下次用时重建。

## 一个回合

1. 读者那句照今天写进对话文件。
2. 对话忙时 `startTurn` 抛 `TurnBusy`（reset 落在 run 中间会结束那个 run）。不忙则一次 commit 写本对话的 `rp.desk` 文档：这回合装配好的系统提示各段、工具名单，加 `purpose`、`maxRounds`、`excludeTs`（读者那句在文件里的 ts，历史读取器据此排除）；`configure()` 写模型和思考档（[75](./75-两档模型.md)）。
3. 建一个回合任务 `rp.turn`（我们 extension 的 `tasks`，`background: true`，所以对话 `abort()` 不会连带它）。它的步骤：`submit({ type: "input", requestId: <任务 id> })`，memo 记下 submission id；`wait()` 这次 submission，再 `conversation.waitForIdle()`；落盘，memo 记已落。一个回合可以跨多个 run：最后一轮回答结束时取到的 steer 会结束原 run、原 submission 先结算，再开下一个 run（坑 519），所以 `rp.turn` 等对话空闲才落盘。
4. 界面订阅这个对话的 `viewState()`：`pi.live` 的半句喂流式行，`pi.live` 的工具调用喂阶段行，`pi.inbox` 喂 steer 行。

系统提示由 section 渲染，section 读 `rp.desk`。系统提示拆成几段（soul 的稳定部分、桌上的东西等）。每回合 `reset()` 之后各段都会重写成 `pi.system` 条目（坑 517），库的增长按每回合一份完整系统提示算；发给 provider 的文本没变，prompt cache 不受影响。

进入一个对话的输入只有两条路：读者在看的这条线程里插话走 steer（`submit({ whenBusy: "steer" })`）；其余全部经 `startTurn` 开新回合，包括铃和将来 agent 之间的跨对话请求。目标对话忙时不排 pi-durable 的 follow-up：铃留在它自己的文件里不投递，跨对话请求留在发起方，都等目标对话的 `rp.turn` 落盘完成后再起回合；铃投递之后才 `delivered`、ack，照旧。

工具注册是进程级的，一个名字一份。工具执行时经 `api` 读本对话的 `rp.thread`，按 place 找到登记的桌面解析器（今天 `soul/delivery.ts` 的 opener 就是），拿到这本书或这个地方的上下文，再交给今天的 `build*Tools` 造出的那个工具执行；解析结果按对话在进程内缓存。`legion/durable` 不 import soul 和领域，解析器在打开 Harness 时注入。

## 上下文与 budget

`GenerationTask` 的 `beforeRequest` hook 换掉每次请求的 messages：对话文件里的历史（今天的 `HISTORY_KEEP` 裁剪不变，不含本回合读者那句）加上本回合在库里的条目（读者那句、各轮回答和工具结果、steer）。每回合开始前对话 `reset()`，模型只看得见本回合。不往库里灌历史。

同一个 hook 里走 `src/budget` 的 `fitRoundToBudget`，每轮重算不写回。被裁成桩的工具结果按对话记在进程内，回合结算时清，重启后从头量。轮数上限也在这里，从 `request.messages` 数本回合的 assistant 消息。量不下或超轮数时 hook 拦不住请求（坑 516）：`beforeRequest` 记下拒绝，从外面 `abort()` 对话，自己挂在 `awaitWithContext` 上不让请求发出；run 以 aborted 结算，`rp.turn` 把记下的拒绝作为 `refusal` 交给 lander 落盘，同今天两种拒绝。拒绝记在进程内，记下后进程被杀就只落已说的话。

遥测和用量走 `afterResponse`：每条从 provider 回来的消息调一次 `ai/model-usage.ts` 的 `recordModelCall`，重问也记（那是真花的钱）；hook 在崩溃后重跑时用 memo 去重。`pi.usage` 不读：它在库里、随换代清零，用量的记录仍是 `recordModelCall` 那份日志。

## 落盘

`rp.turn` 的落盘那步只做一次：

- 读本回合的条目（从原 submission 的 `pi.user` 起，到本回合内所有 requestId 为 `steer:` 的 run 为止），只取 `pi.assistant` 的文字，`stopReason: "aborted"` 的那条除外（坑 511：被杀的半句，和重问的回答不拼接）。被杀的回合怎么处理见下一节。
- 按 steer 的 `pi.user` 条目切成几条消息，steer 那几行读者的话夹在中间，顺序同 transcript。工具的 trace、回执单从 `pi.tool-result` 的 details 派生（[72](./72-聊天的可见性与steer.md) 的 `receipt` 走 details）。
- 每条消息的 ts 由 `rp.turn` 输入里记下的开始时刻定，按行序递增（pi-durable 的 id 是整数，推不出时间，坑 518）；steer 行用 requestId `steer:<界面行 ts>` 里的界面 ts，落盘时从 `storage.scanSubmissions`（本对话最近 200 条）找回。对话文件的写入遇到同 ts 的消息跳过。先写文件，再 memo「已落」，中间被杀则重跑时按 ts 跳过。
- 不在看这条线程时照今天放盒子卡片（`soul/landing.ts` 的顺序：先落文件、flush，再放卡片）。

停止键是 `conversation.abort()`。abort 之前读出 `pi.inbox` 里还没注入的 steer，写进对话文件当下一回合的开头。在线 abort 时 pi-durable 自己把半句写成 aborted 的 `pi.assistant`，停止不写 `rp.partial`。submission 以 aborted 结算后 `rp.turn` 照常落盘：已说的话（含 aborted 的半句）、跑完的工具和回执单，同 72。什么都没产出就不落。

## 被杀之后

进程起来，装好 extension，`resume()` 之前对每个未结算的 submission 分三种：

| 死在哪 | 判据 | 做法 | 读者看到的 |
|---|---|---|---|
| 正文中间 | `pi.live.generation` 有半句 | 先一次 commit 把 `pi.live` 里的半句存进本对话的 `rp.partial`，再 `conversation.abort()`，不重问 | 回复落成已写下的那些：之前几轮的话加这半句，同今天（坑 395、391） |
| 工具里 | 生成任务在等工具 | `resume()`：不可重放的工具得到 interrupted 的结果，可重放的重跑，模型接着说 | 整个回合的话，含死前几轮已提交的 |
| 一个字没写 | 都不是 | `abort()` | 什么都不落，同今天 |

`rp.partial` 只在恢复时写，凡是有半句且不是「工具里」都写（含到两次放弃后的 abort）。落盘时 aborted 那半句取 transcript 里的 `aborted` 条目，没有就取 `rp.partial`；两者都有只用一份。恢复里要 abort 的对话走 `stopTurn`，被撤回的 steer 随结果交回。每次进程起来给这个 submission 记一次尝试（本对话的 `rp.recovery` 文档，被看门狗取代的 submission 也记在这里），到两次就 `abort()`，同今天 `MAX_ATTEMPTS`；尝试按 run 的第一个 input 计。

被恢复的对话在 pi-durable 里就是忙的：读者打开那条线程会看到在流的行，停止键和 steer 照常生效。今天的 `hold` 不再需要。

## 停摆

90 秒看门狗留着（坑 390、491），管 iOS 冻结后连接不报错也不结束的那条路。它改看 `pi.live` 的提交节拍，工具在跑时暂停；到点先在本对话的 `rp.recovery` 里把这个 submission 标成被取代（它的 `rp.turn` 因此不落盘，同今天丢掉写了一半的那行），再 `conversation.abort()`，按今天的规矩重问一次（新的 requestId），第二次就报失败。回合总时限（`TURN_LIMIT_MS`）同样走 abort。`stream.timeoutMs` 管单次请求，取值大于真模型带思考的最长首包，两者分工在第一阶段实测后定。

## 换代

库只增不减，大小靠整库换代：

1. 每个回合结算后看库文件大小。超过 100 MB，且 `inspect()` 没有活任务、没有未结算的 submission（background 任务也算活任务，`waitForIdle()` 不看它们），就换代。
2. `harness.close()`（连带关掉 `SqliteDatabase`），开新代号的库、新 Harness，删旧库（连 `-wal`、`-shm`）。
3. 对话下次用时重建，上下文照常由 `beforeRequest` 从对话文件组装，换代对模型不可见。旧的 Harness 和 Conversation 句柄随之失效，调用方每次从 `runtime.harness` 和 `conversationFor` 重取，不长期持有。

spike 实测纯问答一轮约 5.2 KB（回答 4.3 KB），100 MB 约两万轮。真实回合还带工具结果，每回合 `reset()` 后系统提示整份重写（每轮多一份系统提示的大小），按每轮 20 到 50 KB 算是两千到五千轮，按每天一百轮是一到两个月换一次。阈值等第一阶段实测真实回合的增长后定。

常驻不结束的 agent 会挡住换代（坑 514：close 等在途工具，关完任务留在旧库）。这类 agent 必须能从自己的文件（run 文件、对话文件）重新起来；库超过阈值的 1.5 倍仍不空闲时，`abort()` 有活任务或未结算 submission 的对话（`{ background: true }` 连 background 的一起），换代后重新起。工具里的长等待一律经 `awaitWithContext` 或 `context.abortSignal`，否则 abort、关 app、换代都会挂在它上面。

## 概念对照

| 今天 | pi-durable 下 |
|---|---|
| lane、`held.ts` 的排队 | 对话自带的 busy 和 `pi.inbox`；对话之间并行 |
| `OpenOperation`、坑 308 | 未结算的 submission 和任务 checkpoint，`resume()` |
| `settlePrevious`、session 轮换、留最新五份 | 删；库只有一个，靠换代 |
| recover 的读回（`saidBefore`，坑 391、395、509） | 删；已提交条目就是事实，半句见「被杀之后」 |
| `DELIVERY_ENTRY` | `rp.thread` 文档 |
| `PROMPT_ENTRY` | 删；历史不进库，没有要跳过的 prompt |
| `RECOVERY_ATTEMPT` | `rp.recovery` 文档 |
| `steering.ts` 的差集 | `submit({ whenBusy: "steer" })`，注入与否看 `pi.inbox` 和 transcript |
| 90 秒停摆看门狗 | 留，到点 `conversation.abort()` |
| bell 投递（`soul/bell.ts`） | `startTurn` 进 `deliverTo` 那个地方的对话，requestId `bell:` + 铃 id；对话忙时铃留在它自己的文件里，等该对话的 `rp.turn` 落盘完成后再投；落盘之后才 `delivered`、ack；内部 steer 那条路删 |
| 答铃 steer 进在跑的轮（`reading/delivered.ts`） | 同上，忙就等落盘后起回合，删 |
| subagent（`legion/subagent`） | 工具任务拥有的子对话；brief、quota、诚实失败照旧（见第三阶段） |
| 跨对话协作 | 工具里 `api.conversation(B.id, context)` 拿句柄，B 忙时经 `awaitWithContext` 等 B 这一回合落盘，再 `startTurn` 起回合（requestId `ask:` + `api.taskId`）并 `wait()`；B 的回答按 `settled.answer` 经 Harness 句柄读；工具声明 `replay: "safe"` |
| `toProviderMessages` 里的 budget 梯子 | `beforeRequest` |
| `before_request` 的轮数上限 | `beforeRequest` |
| `message_end` 遥测 | `afterResponse` |
| `prepareArguments` 校验参数 | 工具的 `prepareArguments` |
| 用量记录 `recordModelCall` | 留，挂 `afterResponse`；`pi.usage` 不读 |
| 回合装配（`assembleTurn`、desk、角色） | 留；产物写进 `rp.desk`，工具名单进 `configure({ tools })` |
| `session-fs.ts`、palace `session` 行 | 删；palace 换成 `durable` 行 |

## 工具的 replay

原则：重跑一遍对外界没有新增影响的声明 `safe`，其余 `unsafe`（默认）。读本地数据和联网只读的都是 safe，重跑只多花时间；派活的工具用 `api.taskId` 当 run 的 idempotencyKey（run store 按它去重），重跑找回同一个 run，也是 safe；写记忆、写配置、发卡片、导航、改用户数据的都是 unsafe，中断后模型收到 interrupted 的结果自己决定要不要再做。

| 工具 | replay |
|---|---|
| `observation_search`、`observation_read`、`search_conversations`、`read_conversation`、`list_palace`、`list_kind` | safe（今天已声明） |
| `read_pages`、`search_topic`、`read_annotations`、`read_chapter`、`view_figure`、`read_paper`、`read_note`、`list_saved_articles`、`read_chapter_note`、`read_retell_outline`、`read_talk_outline`、`search_cables`、`read_cable`、`read_picture` | safe：本地读 |
| `find_paper`、`walk_citations`、`search_papers`、`read_page`、`probe_source` | safe：联网只读 |
| `delegate`、`translate_document`、`ingest_url`、`research_literature` | safe：idempotencyKey 或子对话的 requestId 绑 `api.taskId` |
| `observation_update`、`statement_write`、`propose_topic`、`go_to`、`trial_source`、`add_source`、`add_saved_article`、`remove_supplement`、`record_chapter_decision`、`set_talk_spine`、`write_talk_segment`、`move_talk_segment`、`remove_talk_segment`、info 秘书自己那组 | unsafe |

`tests/soul/tool-contract.test.ts` 的 ROSTER 加一列 replay，新工具必须声明。适配层把每个工具（读和写）的 `execute` 包上 `context.abortSignal`，abort 时放手不等（今天 turn.ts 对读工具的做法，坑 508）；写工具放手后才落下的回执没人看到。参数校验交给 pi-durable，不接今天 `prepareArguments` 里的 `recordToolArgs` 遥测。

## 分层

运行时放 `src/legion/durable/`，LAYER 表里已有这一行（capability），改注释即可：

| 文件 | 内容 |
|---|---|
| `harness.ts` | 每设备一个 Harness 的打开、关闭、换代，`rp.conversations` |
| `extension.ts` | 我们的 extension：section、hook（`beforeRequest`、`afterResponse`）、`rp.turn` 任务、文档定义 |
| `tools.ts` | `AgentTool` 到 `ToolRegistration` 的适配，replay、abort 放手、按对话解析上下文 |
| `turn.ts` | 发起一个回合、落盘那步（落盘函数由调用方按 place 注入） |
| `recover.ts` | 进程起来、`resume()` 之前的三分 |
| `stall.ts`、`watchdog.ts` | 第四阶段从 `legion/execute` `git mv` 过来 |

`legion/durable` 只 import platform/app、ai、budget、legion 下的 capability，不 import soul 和任何领域。`platform/app/durable-sqlite.ts` 是宿主接口，一个文件一件宿主能力，不 import 别的目录。不依赖 React 的投影逻辑（view state 到界面行）放 `src/reading/turn/` 的 `.ts` 并配单测。第四阶段删空 `legion/execute` 后从 LAYER 表删掉那一行。

spike 只为测量写的文件（`durable-fs.ts`、`write-meter.ts`、`spike.ts`、`probe.ts`、`sqlite-probe-main.ts`）第一阶段删掉，`sqlite-scenes.ts` 的场景搬进测试。

## 迁移

### 第一阶段：阅读回合

范围是写进书文件的回合：读者在书里的对话（`reading/session/use-call.ts`）、手机课堂（`ui/components/phone/lesson/use-lesson-call.ts`）、答进书里的铃、这些回合的恢复。今天这些回合跑在 soul 的 held harness 上、和其他 soul 回合共用 lane 与 `recover.ts`，切出来之后书的线程只走新运行时。

动：`legion/durable/` 按「分层」写成正式代码；`platform/app/durable-sqlite.ts` 和 `durable_sqlite.rs` 补文件大小查询；palace 加 `durable` 行；`reading/turn/` 的 live-turns 改订阅 `viewState()`，steering、turn-row-split 按 inbox 语义重做；`reading/turn/deliver.ts` 和 `soul/bell.ts` 里 place 为 `book` 的分支改成 `startTurn`（目标忙则等落盘后再投）；`use-call.ts`、`use-lesson-call.ts` 换调用。

删：spike 测量文件；`reading/turn/delivered.ts` 的书那条内部 steer 路；`use-call.ts` 里给 `runAgentTurn` 的 `harness: soulHarness()` 和 `deliverTo`。

解决：书线程上的 308、391、395、509（恢复），507（一个 harness 一次一回合）。291、360、510 的行为由新投影的测试盯住。

并存：pi-agent-core 留 0.87.1，overrides 压一份 pi-ai 1.1.0（坑 495，已验能和 pi-durable 共存）。soul 的其他回合面照旧跑 held harness 和 `recover.ts`；升级后第一次启动时旧 session 里书的未完成回合仍由旧 `recover.ts` 收尾。`liveTurns` 按线程登记，两套运行时都往里登记，答铃据此判断线程忙不忙。

验收：

- bun 下的场景测试：正文中间被杀，落已写的话一次、不重问；工具里被杀，unsafe 得 interrupted、safe 重跑；落盘与 memo 之间被杀不重复落；aborted 条目不和重问拼接；steer 在工具轮里注入、切行顺序对；停止保留半句和回执、未注入的 steer 进下一回合；换代后下一问上下文完整。
- Linux 桌面 app（`xvfb-run`，不开可见窗口）、iOS 模拟器、iPad 真机各走一遍：正文中间杀进程，重开后半句落进线程一次；工具里杀进程，重开后回合跑完落盘；流式中 steer；停止。
- iOS 上的 WKWebView：rusqlite bundled 能编 iOS 目标；用 `sqlite-probe-main.ts` 那套测量打 .dev 包进模拟器和 iPad，量每次提交的 IPC 延迟，不拖慢流式（对照 spike 第 8 节桌面 p50 4 ms）。
- 真模型（Anthropic）：量带思考的最长首包，定 `stream.timeoutMs`；iPad 上流式中切走 app 30 秒，看门狗 abort 后重问一次。
- 真实读书回合的每轮库增长，据此定换代阈值。
- `bun run typecheck`、`scripts/t.sh` 全绿。

量：大，四到五棒 agent。

### 第二阶段：soul

范围：门口对话、info 简报与语音、三餐、排练教练、复述，以及所有 bell 投递。

动：这些回合面的调用改成第一阶段的 `turn.ts`；`soul/bell.ts` 全部改 `startTurn`；`soul/headless.ts` 改成建 `rp.turn` 不等界面；`ui/components/chat/useStreamingTurn.ts`、`use-info-call.ts`、`voice-call-live.ts`、`useRetell.ts`、`useCoach.ts` 换调用；`info/briefer/deliver.ts` 的 opener 改成桌面解析器。

删：`soul/harness.ts` 的回合入口和 `startSoulSession`；`DELIVERY_ENTRY`、`PROMPT_ENTRY` 不再写。`soul/recover.ts` 和 `legion/execute/held.ts` 只留给升级后第一次启动收尾旧 soul session，第四阶段删。

解决：308、368、391、394、395、509 全部，507。

并存：pi-agent-core 仍 0.87.1，只剩旧 session 的收尾、子 agent、后台 pass 和 agent worker 用 `legion/execute`。

验收：门口、info、三餐各一个回合在模拟器和 iPad 上被杀恢复、steer、停止；答铃在对话空闲和忙时各一次（忙时等该回合落盘后才投），重启不重投；语音回合跑通；typecheck、t.sh 全绿。

量：大，三到四棒。

### 第三阶段：子 agent 和后台

范围：`legion/subagent`、legion runner 的 agent worker、后台 pass（`memory/live`、`info/program/live.ts`、`reading/prep/*`）。

动：`subagentTool` 改成 README 那个子对话工具：在 `api.commit()` 里建 `ownership: { kind: "task", taskId: api.taskId }` 的子对话，`configure()` 给它定义里的系统提示、模型、工具集，`requestId: "subagent:" + api.taskId`，`replay: "safe"`；跑完从子对话的条目统计轮数、工具成败，交给 `brief.ts` 照旧出 brief，`quota.ts` 照旧扣池子。隔离由构造保证：父对话看不见子对话的条目，界面不 attach 子对话。程序调用的（蒸馏、prep、agent worker）建 ownerless 对话，跑完不留活任务。

删：`legion/subagent/turn.ts`、`run.ts` 里自己的 runner、`worker:` lane。

解决：307（子 agent 有自己的系统提示和工具）。

验收：文献检索子 agent 在阅读回合里跑通，父 abort 连带子；六种诚实失败的测试搬过来仍绿；蒸馏一次空运行算成功；typecheck、t.sh 全绿。

量：中，两棒。

### 第四阶段：升级与清理

动：pi-agent-core 升 1.1.0 后从 dependencies 删掉，删 overrides，`rm -rf node_modules && bun install` 后确认 pi-ai 只有一份；唯一一处 `AgentMessage` 类型 import 换成 pi-ai 的；`stall.ts`、`watchdog.ts` 搬进 `legion/durable`。

删：`legion/execute/` 剩下的 harness、held、turn、contract 的 lane 部分、observable-run、limiter 等，`soul/recover.ts`；`platform/app/session-fs.ts`；palace 的 `session` 行和 AppData 下的旧 `session/` 目录（启动时删一次）；LAYER 表的 `legion/execute` 行；`tsconfig.test.json` 里 import pi-agent-core 的八个测试文件改写或删。

解决：306、338、367（session JSONL 和旧 harness 的流语法随之消失）；坑 495 关闭。

验收：`bun run typecheck` 两段都过、`scripts/t.sh` 全绿；全端打包；iPad 上走一遍第一、二阶段的杀进程和 steer。

量：中，一到两棒。
