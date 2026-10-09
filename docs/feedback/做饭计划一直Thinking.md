# 做饭计划一直 Thinking

> 2026-09-29 收到。饭菜页点 Plan this week。

## 用户看到的

- 回复行一直是 Thinking，没有出现过 "Drafting the week" 这类工具行，也没有报错，之后再没有反应。
- 点停止没用。

## 原因

以下来自读代码，设备上没有日志，没能确认用户撞的是哪一条。

**回合排一条队。** 所有 soul 回合（读书对话、简报与饭菜对话、语音通话、课堂、复述、排练、后台 bell）共用一个 harness、一条 lane，严格串行：`legion/execute/held.ts` 的 `acquire` 等前一个回合 `release`，没有超时，也不认 abort。前面有一个回合不结束，后面的全部停在 Thinking。

**停摆计时器在排队时就过期了。** 回合唯一的保护是 90 秒停摆计时器（坑 390），它在回合一开始注册。排队超过 90 秒计时器就触发，这时还没有 operation 可掐，计时器结束。拿到 lane 后流如果静默死掉（iOS 冻进程），这个回合就永远占着 lane，后面的回合一个接一个卡住。

**界面分不出在等什么。** 回复行只有 thinking / tool / writing 三档（`ui/components/chat/phase-line.ts`），没收到任何事件、排队中、模型在思考、模型在流式写工具参数，都显示 Thinking。

**另一种可能：第一次调用本身就很慢。** `propose_meals_plan` 一次写满 7 天 × 4 顿，工具行要等参数写完、开始执行才出现。检查不过就要求整周重发，一个回合最多 8 轮。慢模型上这也会表现为长时间的 Thinking。

## 当场修了的

分支 `fix/stall-watch-lane-queue`，坑 491：

- 停摆计时器注册后先 `hold()`，第一次发请求时才开始计时（`legion/execute/turn.ts`）。
- `acquire` 接收回合的 abort 信号，排队中停止或离开页面就放弃排队，自己那一格在前一个回合释放时跟着释放（`legion/execute/held.ts`）。测试在 `tests/legion/execute/turn-stall.test.ts`。

## 哪些回合不能并行

2026-10-09，读代码的结论。

- 同一个对话（同一个 thread id）的回合必须串行：下一个回合的上下文从对话文件组装，要读到上一个回合的回复（docs/71）；读者在回答中途说的话插进正在跑的回合，不开新回合（docs/72）。
- 不同对话之间没有回合持有的共享状态。挡住并行的是 pi 的 harness：工具表、system prompt、`toProviderMessages`、模型表、hooks 和事件都是 harness 级的，对所有 lane 生效（坑 307、499）。一个 harness 同一时刻只能跑一个回合，光开几条 lane 不够。
- session 文件可以共用：pi 的写入走 session 自己的队列，几个 harness 挂在同一个 session 上各管一条 lane 没问题（坑 499）。
- 对话文件、topics、supplements、观察、用量日志各自按路径串行写；子 agent 本来就和 soul 回合并发。不需要回合级的锁。
- 对话路径没有限速器（`limiter.ts` 只管无人值守的批量任务），同时跑的回合数不超过同时开着的对话数，不加全局上限。

## 统一设计做了的

- 按对话分 lane（`legion/execute/held.ts`）：每个对话一条 lane `soul/<threadId>` 和一个独立的 pi harness，共用一个 session；同一对话排队，不同对话并行。对话键是 `telemetry.thread`。闲下来的 harness 丢掉，下次重新挂。恢复（`soul/recover.ts`）认 `soul` 和 `soul/*` 上的 run。线程 id 只在自己的文件里唯一（坑 209），各日期的 `briefing` 会排进同一条 lane，多串行，不出错。
- 回合总时限：held lane 上的回合从 run 开始计，info 30 分钟（周计划一轮写满一周，最多 8 轮），其余 15 分钟（8 轮，每轮生成加一次最长 45 秒的 webview 取页），工具执行期间不暂停（`stall.ts` 的 `turnLimitFor`）。到点和停摆一样 `requestAbort`，界面收到 `TURN_LIMIT_MESSAGE`（`TurnLimitError`），不自动重问。pi 在 abort 之后仍等正在跑的工具（坑 500），只读工具在 abort 时放手，写工具仍等它返回。
- 诊断日志：AppData 下 `turn-log.jsonl`（palace kind `turn-log`，sync local，housekeeper 留尾 5000 行），每行一个 JSON：`start`、`queued`、`lane`、`first-byte`（每轮）、`round`（每轮结束）、`end`（`done` / `aborted` / `stalled` / `timed-out` / `refused` / `error`）。`readTurnLog()` 给以后导出用。
- 回合回调新增 `onWait`：`{ kind: "queued" }` 是排在同一对话上一个回合后面，`{ kind: "first-byte", round }` 是这一轮请求已发出、还没收到字节。
- 周计划检查不过只退回没过的几顿，草稿留着，只重交那几顿（docs/info/73）。

## 还留着的

- 界面接 `onWait`，区分排队、等首包、在思考、在写工具调用（pi 的 `toolcall_start` 在参数写完之前就给了工具名）。`ui/components/chat/phase-line.ts` 还没动。
- 写工具卡死仍会占住它那个对话的 lane，时限也结束不了。
- 日志没有导出入口。
