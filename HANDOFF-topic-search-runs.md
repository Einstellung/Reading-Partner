# 交接：主题搜索第 3 期 run 管线与送达（分支 topic-search/runs）

## 已做（本分支第一个 commit）

- `legion/durable/program-task.ts`：程序任务登记表 `registerProgramTask`，`openDurable` 在恢复前把登记的任务装进 registry（`rp-program` extension，晚登记的会重装）；`runProgramTask` 按 key 建 ownerless 对话（place `program`，不被 recover 当后台 abort，会 resume），同 key 再调时等活着的任务、已完成的直接交回、失败的新建。`background.ts` 导出 `deviceRuntime()`。
- `info/topic-search/run.ts`：`rp.topicsearch`（`defineTask`），相位 open/read/build/deliver/wrap；`BuildTopicSearchResult` 类型在这里导出（签名照任务书，`x: XReadResult`）。没注册构建函数时任务 failed，worker 抛 `GiveUpError(NO_BUILDER)`。每个相位先写后 commit，重跑读已写的（x-read.json、memo `built`/`box-item`/`night-spent`）。
- `run-state.ts`：本机状态 `info-topic-search-state.json`（线位置+30 天见过的 id、每天额度、当晚用量、上次停手），run 目录 `topic-search-runs/<runId>/`（`x-progress.jsonl`、`x-read.json`）。palace 登记两项，`sync: "local"`。
- `halt.ts`：重试规则；`nightly.ts`：01:00 锚点、按设备+夜的固定 0–40 分钟偏移、04:40 截止、`planNight`。
- `run-worker.ts`：worker（5 分钟心跳防 15 分钟 stall）、`askTopicSearchRun`（idempotencyKey 按 88）、`createNightTick`（在飞标记+当夜标记）、`firstRunDispatcher`。
- `runs-live.ts`：live 接线；`registerTopicSearchRuns({ noteHalt, build? })` 已在 `useShellBootstrap.ts` 调；`setTopicSearchResultBuilder(fn)` 给结果构建那边注入；`checkTopicSearchNight` 挂在 `info/program/live.ts` 的五分钟 tick；`resumeXReading()`、`xReadingPaused()` 已有但还没接门口工具。
- `presence.ts` 加 `noteHalt`，`program/live.ts` 导出 `noteCollectorHalt`。
- `once` 字段：`TopicSearch.once?`、卡片 `once?`、Apply 照抄；deliver 相位对 first+once 调 `stopFollowing`。
- i18n 9 语言各加 10 个键（盒标题、停手、确认/恢复工具标签）。
- 测试 `tests/info/topic-search/runs.test.ts`（真 Harness 跑任务、worker、night tick、纯函数）。全套 7540 过，typecheck 过。

## 还没做

1. 门口「对话里说好也能落盘」：加 `confirm_topic_search` 工具（`info/topic-search/` 新文件）。做法：`live.ts` 的 `raiseCard` 包一层把卡片记进进程内 `drafts`（按 threadId），工具取本线程最新的 draft 卡调 `applyTopicSearchCard`，再经新端口通知 `use-door-chat.ts` 把那张卡 patch 成 applied（按 payload kind+name+phase 找 card part，同 `applyTopicSearch` 的 patch）。标签键 `info.tool.confirmingTopicSearch` / `confirmedTopicSearch` 已加。
2. `propose_topic_search` 加可选参数 `once`（boolean，读者只要看这一次）写进卡片。
3. 门口工具 `resume_x_reading` 调 `resumeXReading()`（标签键 `info.tool.resumingXReading` / `resumedXReading` 已加），在 `topicSearchDoorTools` 里挂。
4. docs/88 记偏离（见下）。

## 偏离 88 / 决定

- 01:00 锚点函数放 `info/topic-search/nightly.ts` 不放 `info/program/daily.ts`：program 已 import topic-search，反过来会成环。
- 没设 run 的 `deliverTo`：结果卡还没做，带 deliverTo 会起门口答铃回合。盒项 origin 用 `{ place: "door", date }`。
- 每晚上限按主题拆成多次 run 共享：当晚用量记在状态文件，后面的 run 拿剩下的。
- 每晚 run 一次全派，执行顺序靠 runner 的同 kind 一次一个，不保证按 createdAt。
- first run 在 X 被停手规则挡住时照样 build（x 为 `unavailable`），daily 直接 skipped。
- 停手进盒 `kind: "topic-search-halt"`，body `sources:x.com`；采集端 `halt` 用现有字符串字段，下次简报 run 结束会被覆盖。
- run 目录没清理（retention NEVER）。
