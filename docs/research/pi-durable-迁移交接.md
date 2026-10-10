# pi-durable 迁移交接

依据 [docs/soul/87](../soul/87-回合运行时迁到pi-durable.md)。分支 `dev/pi-durable-p1a`（从 `dev/pi-durable` e14f7013 起）。

## 第一棒做完的

`src/legion/durable/` 的运行时核心，还没有任何调用点：

- `harness.ts`：`openDurable()` 打开 AppData `durable/turns-<代号>.sqlite` 里最新的一代，`conversationFor(key, origin)` 经 `rp.conversations` 找或建对话（`init` 写 `rp.thread`），`maybeRotate()` 换代（`rotateAtBytes` 默认 100 MB、`forceRotateFactor` 默认 1.5，串行），`appDurableHost()` 是 app 里的宿主。打开不 resume。
- `extension.ts`：五个文档（`rp.thread`、`rp.desk`、`rp.partial`、`rp.recovery`、`rp.conversations`），按打开时给的 `sectionKeys` 读 `rp.desk` 的 section，`beforeRequest`（注入的历史读取器 + 本 run 条目、`fitRoundToBudget`、轮数上限、拒绝），`afterResponse`（注入的用量记录器，memo 去重），`rp.turn` 任务（submit、wait、land 三个 checkpoint，memo「已落」）。
- `tools.ts`：`toolRegistration()` 把 `AgentTool` 包成注册，replay 取 `AgentTool.replay`，每次调用经 `rp.thread` 和按 place 注入的 `DeskResolver` 拿到这个对话的工具（`DeskCache` 按对话缓存，每次 `startTurn` 清掉），所有等待走 `awaitWithContext`。
- `turn.ts`：`startTurn`（reset、一次 commit 写 `rp.desk` + `configure` + 建 `rp.turn`）、`steerTurn`（requestId `steer:<界面行 ts>`）、`stopTurn`（abort 前取出 inbox 里没注入的 steer 交回）、`supersede`（给看门狗：标 `rp.recovery` 再 abort）、落盘那步 `createLandStep` 和纯函数 `projectRun`。
- `recover.ts`：`recoverBeforeResume()`，三分加尝试计数，第二次 abort，最后 `resume()`。
- SQLite 门面加了 `durableSqliteSize`（`durable_sqlite_size`，库文件加 `-wal`），已注册、`cargo check` 过。
- spike 测量文件删了；`sqlite-scenes.ts`、`spike.ts` 搬到 `tests/legion/durable/support/`，`sqlite-scenes.test.ts` 照跑。

测试在 `tests/legion/durable/`：`runtime.test.ts`（8 个，同进程）、`crash.test.ts` + `crash-child.ts`（4 个，真 SIGKILL 子进程）、`landing.test.ts`（3 个，`projectRun`）。全量 `scripts/t.sh` 7351 过、0 失败，`bun run typecheck` 过。

## iOS 验收用的 IPC 测量

挪到 `scripts/durable-probe/`（`index.html` + `main.ts`，场景从 `tests/legion/durable/support/sqlite-scenes.ts` 来）。构建、起进程、杀进程、取结果的步骤写在 `main.ts` 文件头：vite 单独打这一页，`tauri build --debug --no-bundle --config` 覆盖 identifier 和 `frontendDist`，结果在探针 identifier 的 AppData `durable-probe/*.json`。iOS 上同一页打 .dev 包进模拟器和 iPad，从 app 容器取 JSON。

## 下一棒（接阅读回合）要做的

- 组装 `openDurable` 的注入：`createModels()` 接 `ai/` 的 provider；catalog 来自各 `build*Tools`；`resolvers.book` 用 `soul/delivery.ts` 的 opener；`landers.book` 写书的对话文件并按 ts 跳过已有消息、不在看线程时按 `soul/landing.ts` 的顺序放卡片；历史读取器照 `HISTORY_KEEP`；`recordResponse` 调 `recordModelCall`；`stream.timeoutMs` 待真模型量。
- 启动时 `openDurable` 后先 `recoverBeforeResume`，把它交回的 steer 写进对话文件。
- palace 加 `durable` 行（sync `local`）。
- `tests/soul/tool-contract.test.ts` 的 ROSTER 加 replay 一列（这一棒没动）。
- `reading/turn/` 的 live-turns 订阅 `viewState()`，steering、turn-row-split 按 inbox 语义重做；`deliver.ts`、`soul/bell.ts` 书的分支改 submit；`use-call.ts`、`use-lesson-call.ts` 换调用；删 `reading/turn/delivered.ts` 书那条内部 steer。
- 文档第一阶段验收的 app 那几项（xvfb、iOS 模拟器、iPad、真模型首包、库增长）。

## 这一棒拍板的

- 拒绝：hook 抛错拦不住请求（坑 516）。`beforeRequest` 记下拒绝、从外面 abort 对话，自己挂在 `awaitWithContext` 上；run 以 aborted 结算，`rp.turn` 把拒绝作为 `LandedTurn.refusal` 交给 lander。拒绝记在进程内，记下后进程被杀就只落已说的话。
- 忙的对话 `startTurn` 抛 `TurnBusy`：reset 在 run 中间落下会结束那个 run。
- 落盘 ts：`rp.turn` 输入里记开始时刻，按行序递增；steer 行用 requestId 里的界面 ts，落盘时从 `storage.scanSubmissions`（本对话最近 200 条）找回。id 是整数推不出时间（坑 518）。
- `rp.desk` 除了各段和工具名单之外还带 `purpose`、`maxRounds`、`excludeTs`（读者那句在文件里的 ts，历史读取器据此排除）。section 不加标签。
- 停止不写 `rp.partial`：在线 abort 时 pi-durable 自己把半句写成 aborted 的 `pi.assistant`（测试验过）。`rp.partial` 只在恢复时写，凡是有半句且不是「工具里」都写（含到两次放弃）。
- 恢复里要 abort 的对话走 `stopTurn`，被撤回的 steer 随结果交回。尝试按 run 的第一个 input 计。
- 被裁成桩的工具结果按「对话 + run 的第一个 input（`pi.live.run.inputs[0]`）」记在 extension 实例里，回合结算时清。
- 适配层对读和写的工具都放手（文档写的是每个工具）；写工具放手后才落下的回执没人看到。参数校验交给 pi-durable，没接今天 `prepareArguments` 里的 `recordToolArgs` 遥测。
- 换代后旧的 Harness 和 Conversation 句柄失效，调用方每次从 `runtime.harness`、`conversationFor` 取。强制换代时 abort 所有有活任务或未结算 submission 的对话（含 background）。打开时不删更旧的代。

## 文档的问题

以下四条已在 docs/soul/87 里改掉。

- 拒绝：改成 abort 加 `refusal` 交给 lander（坑 516）。
- 系统提示每回合整份重写：「一个回合」「换代」已按坑 517 改，阈值等实测。
- 落盘 ts：改成开始时刻按行序递增，steer 用界面 ts（坑 518）。
- 铃在对话忙时：已定不排 follow-up。所有输入经 `startTurn` 开新回合，目标忙则铃留在自己的文件里，等该对话落盘后再投；跨对话请求同理。「概念对照」和第一、二阶段已改。

## 第二棒做完的（分支 `dev/pi-durable-p1b`，从 `dev/pi-durable` 71dc1a40 起）

- `src/ai/durable-models.ts`：`createAppModels()`，`providers.ts` 的每个 provider 包一层：auth 走 `resolveApiKey`，`stream`/`streamSimple` 补 `transport` 和 `DEFAULT_MAX_RETRIES`。
- `src/reading/turn/durable-book.ts`：书的 origin 是今天的 book BoxOrigin 加 `home`（线程文件所在文档），线程键 `book:<home>:<threadId>`。`AssembledTurns` 按线程存本进程装配的历史和工具；历史读取器先用它，没有（重启后恢复的回合）就读文件按 `HISTORY_KEEP` 组；桌面解析器同理，没有就走 `soul/delivery.ts` 的 book opener。`bookLander` 按 role+ts 跳过已有行、写 trace、flush 后放卡片，读者在看或拒绝时不放；拒绝不写文件。`bookUsageReport` 给 `recordModelCall`。
- `src/reading/turn/durable-view.ts`：`projectView()` 把 view state 投影成回合的行，已提交部分直接用 `projectRun`，所以屏幕上的 ts 就是落盘的 ts；`pi.live` 半句进正在写的行，工具槽成工具行，`pi.inbox` 的 steer 成排队行。291、360、510 有单测。
- `src/reading/turn/durable-runtime.ts`：`openReadingDurable()` 组装注入、`recoverBeforeResume`、`landWithdrawnSteers` 把撤回的 steer 写进线程文件；`onTurnSettled` 是「落盘完成」事件（`rp.turn` 落盘那步提交 terminal 之后发，`extension.ts` 的 `settled` / `harness.ts` 的 `onSettled`），给下一棒的铃用。`startReadingDurable()` 单例，`setBookWatching()` 由阅读会话设「读者在不在看」。
- `src/reading/turn/durable-turn.ts`：`runBookTurn()` 是 use-call 要接的无 React 控制器：存装配、`startTurn`、订阅 `viewState()` 调 `projectView` 回调 `onView`、`steer`/`stop`、停摆看门狗复用 `legion/execute/stall.ts` 的 watch（生成有进展就 beat、工具在跑 hold），到点 `supersede` 并把撤回的 steer 交回调用方重问。
- `src/ui/components/common/durable-catalog.ts`：`appToolCatalog()`，tool-contract ROSTER 那些工厂用惰性依赖造出全部工具，只取名字、描述、schema、replay。`useBackgroundServices` 在 `startSoulSession` 旁边调 `startReadingDurable(appToolCatalog)`。
- `legion/durable/turn.ts`：`StartedTurn` 多了 `startedAt`；`supersede(runtime, conversation, submission, context)` 标记后走 `stopTurn`，返回撤回的 steer。
- palace 加 `durable` 行（sync `local`）。只读工具补 `replay: "safe"`，ROSTER 加 `safe` 列和断言。
- 测试：`tests/reading/turn/durable-{view,book,runtime,turn}.test.ts`。

## 还没做的

- `use-call.ts`、`use-lesson-call.ts` 换成 `runBookTurn`：删 `runAgentTurn` 的 `harness: soulHarness()` 和 `deliverTo`；读者那句先写文件，再 `splitAssembled(turn.messages)` 拿历史和那句（带页窗图片时 `content` 要支持图片，`TurnRequest.content` 现在只是 string）；`onView` 的行映射到 `shapes.newRow` 和 reducer（需要一个整段替换回合行的 action）；steer 走 `turn.steer(text, ts)`；停止走 `turn.stop()`，交回的 steer 写文件开下一回合；`settled.stalled` 时照今天重问一次；`setBookWatching` 接 `watching(callRef.current, …)`；拒绝在 `onTurnSettled` 之外没有出口，界面要从 `rp.turn` 结果或 lander 那里拿到 refusal 去显示和 toast。
- `steering.ts`、`turn-row-split.ts`、`live-turns.ts` 的旧逻辑等 use-call 切过去再删；`liveTurns` 按线程登记两套运行时。
- 回前台判死：`runBookTurn` 用的是 `stallWatches()` 单例，`watchAppAwayForStalls` 已由外壳绑定，应当照旧生效，没有单测。
- 停摆路径没有单测（stall watch 的 tick 用真时钟，测试要注入 `createStallWatches({ timers })`）。
- 未查明：`durable-turn.test.ts` 里纯文字回答流式中 steer，steer 被注入（落成 user 行）但 run 没有再生成回答就结算了；工具轮里的 steer（第一棒的测试）正常。测试目前只断言前两行。下一棒先查这是 pi-durable 的行为（最后一轮之后注入的 steer 不再起生成）还是我们的用法，确认后记坑 519。
- 文档第一阶段验收的 app 那几项。

## 第二棒拍板的

- 系统提示只用一个 section `turn`：每回合 reset 本来就整段重写（坑 517），拆段没有收益。
- 历史和桌面工具优先用本进程的装配（页窗图片、旁支的父段、桌面工具都和今天一样），重启后才退到读文件和 opener。
- 落盘跳过按 role+ts，不只按 ts（同毫秒的问和答见坑 291 附近那条）。
- 拒绝不写进线程文件，同今天（只在行上显示）。
- catalog 用惰性依赖调各工厂。`go_to` 只在外壳登记过 place 之后才有，所以在 `useBackgroundServices` 里建。
- `delegate`、`translate_document`、`ingest_url`、`research_literature` 仍是 unsafe：文档说它们 safe 的前提是 idempotencyKey 绑 `api.taskId`，适配层现在没把 task id 交给工具，重跑会派第二个 run。接上之前不能标 safe。

## 发现的文档问题

- 「工具的 replay」表把四个派活工具列为 safe，前提（idempotencyKey 绑 `api.taskId`）还没实现，见上。
