# pi-durable 迁移交接

## 第一阶段现状

截至第八棒（`dev/pi-durable-p1i`）。

已切到新运行时的回合面：读者在书里的对话（`reading/session/use-call.ts`，手机 EPUB 课堂 `use-book-lesson.ts` 走它）、手机 PDF 课堂（`ui/components/phone/lesson/use-lesson-call.ts`）、答进书里的铃（`reading/turn/deliver.ts`）、这些回合被杀后的恢复（`reading/turn/durable-runtime.ts` 启动时 `recoverBeforeResume`）。重启后恢复的回合，读者打开那条线程时接上：看得到在流，停止和插话够得着，落盘中发的话等它结算后开新回合（第七棒），挂同一个停摆看门狗（第八棒）。书回合写 turn-log 诊断行，开发构建记 `recordLongestSilence`（第八棒）。

真机验收前已知的缺口：

- 恢复时被 abort 的回合落盘那几毫秒里打开线程，屏幕上少掉写回的插话和半句，重开线程才对（第七棒，已知不处理）。
- 工具参数校验的 `recordToolArgs` 没接：pi-durable 的 `prepareArguments` 要求纯函数、重试时会重跑，也拿不到模型。
- 没有人打开的恢复回合不挂看门狗，turn-log 里也没有它的 `first-byte`（首字节取自线程的 view）。

下一棒真机验收清单（Linux 用 `xvfb-run`，iOS 模拟器，iPad 真机；全部用 .dev 包名）：

- 正文中间杀进程：重启后线程里是已说的话加半句，不重问。
- 工具里杀进程：重启后可重放的工具重跑、模型接着说；打开线程看到它在流。
- 重启后打开有在途回合的线程：看到在流的行，停止键在；停止保留半句和回执；插话进同一回合；回合正在落盘时发话，等它落完开新回合，不出失败行。
- 插话：正文流式中、工具在跑时各一次，行的位置同今天。
- 停止：保留半句和回执，交回的插话开下一回合。
- 铃：线程空闲时投、线程忙（读者回合在跑）时等它落完再投；读者在看时流式出现、可停可插话。
- 真模型只用 Haiku：量首包时间，定 `stream.timeoutMs`（大于带思考的最长首包）。
- 真实回合的库增长：记若干回合前后 `durable/turns-*.sqlite`（含 `-wal`）的大小，算每回合字节数，回填 87「换代」的阈值。

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
- 停摆路径的单测第三棒补了（`durable-stall.test.ts`）。
- 纯文字回答流式中 steer 不出回答：第三棒查明并修好，见坑 519。
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

## 第三棒做完的（分支 `dev/pi-durable-p1c`，从 `dev/pi-durable` a283b163 起）

- 纯文字回答里 steer 不出回答是 pi-durable 的语义（坑 519）：`final` 边界取到的 steer 结束原 run、原 submission 先结算，steer 开下一个 run。`rp.turn` 的 wait 那步在原 submission 结算后再 `waitForIdle()`；`createLandStep` 把原 submission 之后、requestId 为 `steer:` 且已放下的 submission 都算本回合，状态取最后一个，superseded 和 `rp.partial` 按这一串判。`durable-turn.test.ts` 断言已放开。
- `TurnResult` 加 `reason`、`detail`、`refusal`；落盘的 memo 改名 `landing`，存整个结果。
- `TurnRequest.content`、`BookTurnRequest.line.content` 支持图片（`TurnContent`）。
- `reading/turn/book-turn-rows.ts`：`driveBookTurn()` 把每次 view 映射成 `CallRow` 交给 `onRows`，`ended` 给出 answered / stopped（带撤回的 steer）/ refused / failed / stalled；`turnEnd()` 是判定的纯函数；`afterStall(attempt)` 第一次重问，第二次报 `STALL_MESSAGE`。
- `call-state.ts` 加 `turn-rows` action：替换读者那句之后的所有行，`mergeTurnRows` 让没变的行保持原对象。
- `live-turns.ts` 的条目加 `rows` 和 `durable`（steer、stop 句柄），`withLive` 带上全部 rows。
- `setBookWatching(probe)` 可登记多个，返回撤销函数。
- 测试：`tests/reading/turn/durable-stall.test.ts`（假时钟：90 秒判死、工具 hold、回前台判死、重问策略、结局判定）、`book-turn-rows.test.ts`。全量 `scripts/t.sh` 7372 过、1 跳过、0 失败，`bun run typecheck` 过。

## 第三棒没做完的

use-call.ts 和 use-lesson-call.ts 都没动，旧逻辑一行没删。原因是 `tests/reading/session/use-call-*.test.tsx` 约 48 个测试 spy `runAgentTurn`，切调用点要连这些测试一起改，预算不够。下一棒按下面做：

- `use-call.ts` 的 `runTurn`：读者那句的 ts 取线程文件里最后一条 user；先画占位流式行；`buildReadingTurn` → `splitAssembled` → `readingDurable()` → `driveBookTurn`。origin 是 `turn.origin` 加 `home`；`describe` 用 `turn.tools` 的 `toolLabel` 和 `quiet`；`thinkingLevel` 取 `toReasoning(s.chatThinking)`。`onRows` 经 `shapes.newRow` 发 `turn-rows`（rows 为空时不替换占位行），同时写进 liveTurns 条目的 `rows`。
- 结局：answered、stopped 用最终 rows 再发一次 `turn-rows`（answered 时最后一个 AI 行带 `turn.notice`），然后 `syncFocusChapter`、`onSettled`；stopped 交回的 steer 和条目上没送出去的行写文件、`row-appended`，再开一回合。refused、failed 走 `showFailure`：失败行放在回合最后一行之后，用 `row-changed` 带 retry；不在看时只放 error 卡片，答案卡片由 lander 放。stalled 清掉回合行、写 steer，按 `afterStall` 重问或报失败。
- `send`：有 `live.durable` 时 `durable.steer(text, at)`；返回 false（run 还没起，或已结束、正在落盘）就记在条目上、画 queued 行，结局时写文件开下一回合。`stop`：`live.durable.stop()`；还在装配时 abort 并删占位行。`releaseThreads` 对 durable 条目调 `durable.stop()`。
- `setBookWatching` 放进 useEffect，probe 是 `watching(callRef.current, bookIdRef.current, …)`，cleanup 用它返回的函数。
- reducer 的 `row-arrived` 要按 role+ts 去重：lander 用 `appendMessage` 写文件，不经 `appendOwn`，`onThreadMessage` 会把落盘的行当外来消息再加一遍。
- 删 use-call 里的 `runAgentTurn`、`soulHarness`、`deliverTo`、`createSteering`、`createDelivered`、`createRowSplit`、`rowTsAfter`、`flushSteering`、`keepPartial`。use-call 测试改成 spy `book-turn-rows` 的 `driveBookTurn` 和 `durable-runtime` 的 `readingDurable`，或用 faux provider 起真运行时；`use-call-delivered.test.tsx` 测的是要删的内部 steer 路，一起删。
- `use-lesson-call.ts`：现在用 `useStreamingTurn` 的 `begin` 和 `run.handlers`。切过去要自己管回合行和 streaming 状态，用同一个 `driveBookTurn`。课堂不 steer。
- 删旧逻辑：`steering.ts`、`turn-row-split.ts` 还被 `useStreamingTurn`（soul 回合面）和 `deliver.ts`（答进书里的铃）用。use-call 切完只删只给它用的部分（`rowTsAfter`、`RowSplit.delivered` 等）；`delivered.ts` 等 `deliver.ts` 改 submit 时再删。
- 新路径没有 `runAgentTurn` 的 `telemetry`（surface、inline、thread）日志，只有 `recordModelCall`。

## 第三棒拍板的

- 一个回合可以跨多个 run：final 边界取到的 steer 开的 run 属于本回合，落盘等对话空闲。
- 被裁成桩的工具结果按对话记、回合结算时清（第一棒按 run 记）。
- 失败和拒绝的文案从 `rp.turn` 的结果拿，不另开出口。

## 第三棒发现的文档问题

- docs/soul/87「一个回合」第 3 步写 `rp.turn` 只 `wait()` 这次 submission，「落盘」写「读本 run 的条目」。纯文字回答里的 steer 会开下一个 run（坑 519），回合不等于 run，应改成「等对话空闲，读本回合（从这次 submission 的 `pi.user` 起，含 steer 开的 run）的条目」。没改，等定。
- 87「上下文与 budget」写「被裁成桩的工具结果按 submission 记」，现在按对话记。
- `docs/pitfall/README.md` 第 80 行「下一个是 516」过期了。

## 第四棒做完的（分支 `dev/pi-durable-p1d`，从 `dev/pi-durable` a40e84ad 起）

- reducer 的 `row-arrived`：到达的行带 id、屏幕上同 role+ts 的行没有 id（界面自己画的）时视为同一行，不再加一遍。两个都带 id 的照旧按 id 分。
- `use-call.ts` 切到新运行时：读者那句先写文件，ts 取文件里最后一条 user；先画占位流式行；`buildReadingTurn` → `splitAssembled` → `readingDurable()` → `driveBookTurn`；每次 view 经 `shapes.newRow` 发 `turn-rows`，同时写进 liveTurns 条目的 `rows`。页窗图片走 `line.content`。origin 优先 `turn.origin`，不是 book 时按 bookId/threadId/annotationId 拼。
- steer：条目上有 `durable` 就 `steer(text, ts)`；行先记进条目新增的 `unsent` 并画 queued，steer 返回 true 才从 `unsent` 去掉。装配期间说的话等 `durable` 接上后逐条 steer。bell 自己的回合（`silent`）照旧走 `live.steering`。
- 结局（`finish`）：answered 用最终 rows 发 `turn-rows`，最后一个 AI 行带 `notice`，`syncFocusChapter`、`onSettled`；stopped 去掉空 AI 行；refused / failed 走 `showFailure`，失败行是回合最后一行之后新的一行，`row-changed` 带 retry，不在看时只放 error 卡片；stalled 清掉回合行按 `afterStall` 重问一次。交回的 steer 和 `unsent` 合并按 ts 排序写文件、`row-delivered`；answered 和 stopped 之后开下一回合，失败不开。
- 停止：有 `durable` 时只调 `stop()`，条目留到 `ended`；还在装配时 abort、删占位行、写 `unsent` 并开下一回合。删线程时 `releaseThreads` 同时调 `durable.stop()`。
- `setBookWatching` 在 useEffect 里登记，probe 是 `watching(callRef.current, bookIdRef.current, …)`。
- 删掉：use-call 里的 `runAgentTurn`、`soulHarness`、`deliverTo`、`createSteering`、`createDelivered`、`createRowSplit`、`rowTsAfter`、`flushSteering`、`keepPartial`、`isStall`；`turn-row-split.ts` 的 `rowTsAfter`、`RowSplit.delivered` 和整套 origin。
- 测试：`tests/support/use-call.ts` 加 `fakeBookTurns()`，spy `readingDurable` 和 `driveBookTurn`，测试自己发 view 和结局。`use-call-steer.test.tsx` 重写成 9 个（line/model/origin、steer 不开第二回合、view 接管 queued 行且没变的行保持原对象、停止后交回的 steer 开下一回合、来不及 steer 的话在回答后开下一回合、停止留回执、停止无产出不留行、拒绝和失败、判死重问一次）。thinking、hangup、open、arrivals、aside、reopen、phone-reader-render 的 `runAgentTurn` spy 换成 `fakeBookTurns`，断言不变（hangup 的 AI 行改成 lander 写的，无 minted id）。全量 `scripts/t.sh` 7358 过、1 跳过、0 失败，`bun run typecheck` 过。

删掉的测试：

- `use-call-delivered.test.tsx` 全部 7 个：测的是 bell 送进正在跑的书回合（`createDelivered`），这条内部 steer 路随 use-call 切换没了。
- `use-call-steer.test.tsx` 里 7 个：「user / ai / user / ai 写文件」「行交接时带 trace」「只有回执的行留在线上方」「行空时交接把回答挪到线下」「交接后马上停止只存一次」「停止保留半句写文件」「停止留回执写文件」里写文件的部分。写文件和行切分现在是运行时的事，由 `durable-turn.test.ts`（落盘顺序）、`durable-view.test.ts`（291、360、510）、`durable-book.test.ts` 覆盖。界面上能看到的那部分在新测试里保留。
- `turn-row-split.test.ts` 里 7 个：6 个测 `delivered` 和 origin，1 个测 `rowTsAfter`，被测的代码删了。

## 第四棒拍板的

- use-call 测试打桩在 `driveBookTurn`（不是起真运行时加 faux provider）：hook 的事是把 rows 画上屏、处理结局、接 steer 和停止，打桩能精确控制交接和结局的时机；运行时本身已有 faux provider 的测试。
- 停止不再立刻收尾：条目留到运行时结算，期间 `isAnswering` 仍为 true，界面的停止键也还在。
- steer 失败（reject）当作没被收下，留在 `unsent`。

## 第四棒没做完的

- `use-lesson-call.ts` 没切。手机课堂（`use-book-lesson.ts`）走的是 `useCall`，已经跟着切了；`use-lesson-call.ts` 是另一条（EPUB 课堂），照第三棒那条做。
- telemetry：新路径只有 `recordModelCall`。`runAgentTurn` 给书回合还写 `recordCacheTurn`（surface `reading`、`inline`、thread、round、请求开始时刻、retention）。`recordResponse` 拿不到 inline 和 round，要从 `AssembledTurns` 带 inline、按对话数本回合的轮次。turn-log 的诊断行和 `recordLongestSilence` 也没有。
- `live-turns.ts` 的 `openRow`、`patch`、`split` 只剩旧书回合用过，没删（`live-turns.test.ts` 有 5 个测试用 `patch`，要一起改）。`delivered` 字段和 `delivered.ts` 等 `deliver.ts` 改 submit 时删。
- `deliver.ts` 的 `deliverIntoReadingTurn` 现在永远返回 null（书回合条目不再带 `delivered`），bell 会走自己的回合；它的 `holdReadingTurn` 在书回合还在跑时 `turns.start` 会打印「second turn」并 abort 我们的 controller（不会停掉运行时的 run，但条目会被换掉，该回合结局时 `settle` 找不到条目就静默）。改 submit 那棒一起处理。
- 回前台判死、真机和模拟器验收没做。

## 第五棒 A（分支 `dev/pi-durable-p1e`，从 `dev/pi-durable` dff1d60c 起）

做了：

- 答进书里的铃走新运行时：`reading/turn/deliver.ts` 的 `deliverBookBell`，经 `soul/delivery.ts` 新的 `registerTurnDelivery` / `turnDeliverer`（替换 `registerLiveDelivery` / `liveDeliverer`）。线程在 liveTurns 有登记就等登记撤掉再起回合；`startTurn` 抛 `TurnBusy`（重启后恢复的回合，没有界面登记）就等该对话的 `onTurnSettled` 再试。
- 铃的回合在 liveTurns 登记为 `visiting: { after }`，带 rows 和 durable 句柄。use-call 用 `listen` 在读者看着时画它的 rows；停止、插话和自己的回合走同一条路；没被收下的话写进文件，不开新回合。
- 铃是 `startTurn` 的输入（`TurnInput.bell`），不进文件。lander 给读者开口之前的 AI 行盖 `origin.runId`，不放通用卡片；卡片照旧由 `bell.ts` 放，cover 取回答第一句。回合落盘后 `bell.ts` 才 delivered、ack、markDelivered；失败（停摆、模型错、停止时一句没说）走 onTrouble，铃留着。
- 重启不重投：`legion/durable/turn.ts` 的 `bellTurn()` 按 `rp.turn` 任务输入里的铃 id 找本对话已有的回合并等它结束；`done`，或 aborted 且落了东西，算答过，直接 ack（cover 取文件里盖了这个 runId 的最后一行）。
- 缓存遥测：`ResponseRecorder` 的 `about` 加 `round`（`beforeRequest` 按对话记），`AssembledBookTurn` 加 `telemetry`（surface、inline），`recordResponse` 同时调 `recordCacheTurn`（`bookCacheTurn`：startedAt 用 `message.timestamp`，retention 用 `resolveRetention()`）。use-call 传 `reading` 加 `turn.inline`，铃传 `bell`。恢复后的回合没有装配，按 `reading`、inline 缺省记。
- live-turns 删 `openRow`、`patch`、`split`、`steering`、`delivered`、`silent`，加 `visiting`、`listen`、`touch`。删 `delivered.ts`、`deliverIntoReadingTurn`、`holdReadingTurn`；`openBookDelivery` 不再给 `hold`，所以 `soul/recover.ts` 收尾旧 session 里书的回合时不再占线程。
- 测试：`tests/reading/turn/deliver-bell.test.ts`（faux：空闲时投、忙时等且不顶掉书回合的登记、重启不重投、失败不答）；`tests/soul/bell.test.ts` 的三个 live delivery 测试换成 turn deliverer 的四个；删 `deliver-live.test.ts`、`delivered.test.ts`；`tests/legion/durable/runtime.test.ts` 断言 round。全量 `scripts/t.sh` 7346 过、1 跳过、0 失败，`bun run typecheck` 过。

没做：

- visiting 回合在 use-call 里的显示、插话、停止没有 hook 层测试。
- 等忙线程时整个铃 pass 阻塞在那里，读者那一回合跑多久，后面的铃就等多久。
- `startTurn` 的忙判断只看 `pi.live.run`：恢复的回合正在落盘那一步时判为不忙，铃的 reset 会落在它落盘之前。第一棒的判断，没动。
- 真机、模拟器没验。

拍板的：

- 铃的回合用 talk 档模型和 `chatThinking`（同今天 `sendHeadless`）；文件 home 取 bookId（同今天）。
- 停止的铃回合说了话算答过并 ack，一句没说算失败、下一轮再投；停摆算失败。
- 「线程空闲」看 liveTurns 登记是否撤掉（书回合的登记在 `rp.turn` 落盘之后才撤），没有登记的看 `onTurnSettled`。
- bell.test.ts 的 opener 路测试在 helper 里登记一个返回 null 的 turn deliverer：别的测试文件会留下 `registerBookDelivery()` 的登记。

文档问题：

- 87「概念对照」bell 一行写 requestId 是 `bell:` 加铃 id。实际 requestId 仍是 `turn:<任务 id>`，铃 id 记在 `rp.turn` 的任务输入里，靠 `scanTasks` 找回。没改。

## 第五棒 B（分支 `dev/pi-durable-p1f`，从 `dev/pi-durable` dff1d60c 起）

做完的：

- `use-lesson-call.ts` 切到新运行时，照第四棒 use-call 的做法：读者那句先写文件，ts 取文件里最后一条 user；先画占位流式行；`buildReadingTurn` → `splitAssembled` → `readingDurable()` → `driveBookTurn`，origin 优先 `turn.origin`，`home` 是 bookId；每次 view 替换读者那句之后的行。课堂不经 reducer，`call-state.ts` 把 `turn-rows` 的逻辑提成 `withTurnRows()`，reducer 和课堂共用，没变的行保持原对象。
- steer：回合进行中 `send` 画 queued 行、记进 `unsent`、`driven.steer(text, ts)`，收下才从 `unsent` 去掉；装配期间说的话等 `driven` 接上后逐条 steer。
- 结局：answered 最后一个 AI 行带 `notice`；stopped 去掉空 AI 行；refused / failed 在回合行之后另起一行（refusal 是 notice，error 是 `⚠️ Couldn't reach the model. …`，文案同旧课堂）；stalled 清掉回合行按 `afterStall` 重问一次。交回的 steer 和 `unsent` 合并按 ts 写文件，answered、stopped 之后开下一回合，失败不开。
- 停止：有 `driven` 时只调 `stop()`，回合留到结算，期间 `streaming` 仍为 true；装配中停止则 abort、删占位行、写 `unsent` 并开下一回合。离开（卸载）对运行时调 `stop()`，结算时只写交回的 steer，不画、不开下一回合。
- `read_chapter`：view 里出现就勾章节，工具结算数增加时读一次 focus。
- 删掉课堂里的 `runAgentTurn`、`soulHarness`、`deliverTo` 和 `useStreamingTurn`。
- 测试：新增 `tests/ui/components/phone/lesson/use-lesson-call.test.tsx` 11 个，用第四棒的 `fakeBookTurns()`，另 spy `setBookWatching`。全量 `scripts/t.sh` 7369 过、1 跳过、0 失败，`bun run typecheck` 过。

删掉的测试：无。课堂原来没有 hook 的测试。

拍板的：

- 课堂接了 steer。旧 `send` 在回合进行中直接 return，CallView 的输入框照样能发，话就丢了；现在和 use-call 一样进回合。第三棒写的「课堂不 steer」作废。
- 离开课堂时半句落进线程文件。旧路是丢掉半句；新运行时只有 `stop()`，在线 abort 时半句由 pi-durable 落盘，`driveBookTurn` 没有丢弃的出口。
- `setBookWatching` 按回合登记、结算后撤销，不按屏幕。课堂回合跑着时课堂一定在屏幕上，离开就停，所以课堂的回答永远不放卡片，同旧路；离开时 stop 落下的半句也不会被当成没人看的回答。
- 失败行另起一行，不写进回答行，同第四棒 use-call。
- `line` 不带 `content`：课堂不栅格化页面，没有页窗图片。

还剩的：

- app 和模拟器里没跑过课堂（xvfb、iPhone 模拟器、真模型）。
- telemetry 同第四棒：只有 `recordModelCall`，课堂的 `surface: "reading"`、inline、thread 日志没了。
- `useStreamingTurn` 的 steer 部分（`steering.ts`、`turn-row-split.ts`）只剩 coach、retell、info 和 `deliver.ts` 用，课堂切走后没删。

文档的问题：

- 第四棒和派活说明都把 `use-lesson-call.ts` 叫「EPUB 课堂」。它是手机 PDF 课堂（docs/74，`openPhonePdf`）；手机 EPUB 课堂（docs/77）是 `use-book-lesson.ts`，走 `useCall`，第四棒已经跟着切了。

## 第六棒（分支 `dev/pi-durable-p1g`，从 `dev/pi-durable` b1672527 起）

做了：

- 判忙：`legion/durable/turn.ts` 的 `startTurn` 在本对话有 run，或最新一个 `rp.turn` 还不是 terminal（含正在落盘那步）时抛 `TurnBusy`。`steerTurn` 仍只看 `pi.live.run`：落盘中没有 run 收那句话。`deliver-bell.test.ts` 加了复现：没有界面登记的回合卡在落盘的 flush 上，铃不发请求，落盘完才起自己的回合。
- 铃队列：`TurnDelivery` 加 `onWait`，`deliverBookBell` 开始等忙线程时调（等界面登记撤掉、`TurnBusy` 后等落盘、重启后等本铃先前的回合）。`soul/bell.ts` 的 pass 收到后把这只铃挂到后台等，接着投后面的铃；同一对话后响的铃排在它后面，前一只失败就不投、留给下一轮。挂起的铃跨 pass 存在，后面的 pass 跳过它，它不计入本 pass 的返回数。`bell.test.ts` 加了一个：三只铃，第一只的线程忙，第二只（别的线程）照投并 ack，第三只（同线程）等第一只落完再投。
- use-call 层的铃回合测试：`tests/reading/session/use-call-bell.test.tsx` 3 个，真的 `answerBell` + `deliverBookBell`，只对 `driveBookTurn` 打桩（`fakeBookTurns()`）。读者在看时铃回合流式出现在线程里、停止键到达它、插话 steer 进它且不开第二回合；停止后说了话 ack，一句没说 onTrouble、铃留着。
- docs/soul/87：「一个回合」的判忙、「概念对照」铃那一行（requestId 是 `turn:<任务 id>`，铃 id 在任务输入里）、第一阶段范围里两个课堂的文件名和文档号。

拍板的：

- 判忙只查最新一个 `rp.turn`：`startTurn` 忙时拒绝，同一对话不会有两个未结算的。
- 挂起是投递方报的（`onWait`），pass 不自己判忙。不挂起的铃仍一只一只投。

## 第七棒（分支 `dev/pi-durable-p1h`，从 `dev/pi-durable` 6940a038 起）

做了：

- `legion/durable/turn.ts` 的 `turnInFlight(runtime, key)`：经 `rp.conversations` 找对话（找不到不建），最新一个 `rp.turn` 不是 terminal 就交回对话、`startedAt`（取自任务输入）和结算的 promise。`startTurn` 和它共用结算那段（`forgetStubs`、`maybeRotate`）。
- `reading/turn/durable-turn.ts`：订阅 `viewState()` 投影成行的那段提成 `followTurn`，`runBookTurn` 和新的 `resumedTurn` 共用；`resumedTurn` 交回 `startedAt` 和 `follow(onView)`，steer、stop 同 `runBookTurn`。工具行的标签用新加的 `ReadingDurable.describe`（catalog）。
- `reading/turn/book-turn-rows.ts`：`resumedBookTurn(durable, { home, threadId })` 交回 `after`（即 `startedAt`）和 `follow(onRows)`，结局判定和 `driveBookTurn` 同一段。
- use-call：`openThread` 时线程有消息且 liveTurns 没登记，就查在途回合；有就以 `runTurn(…, resumed)` 接上，不装配，`after` 用回合的 `startedAt`。之后同本会话起的回合：登记 liveTurns、画行、停止走 `durable.stop()`、插话走 `steer`、结局走 `finish`（交回的插话和没送出的话写文件后开下一回合）。`setBookWatching` 用会话原有的那个 probe。
- 手机 PDF 课堂：打开线程后同样查，接上走 `runTurn(0, resumed)`，按回合登记 `setBookWatching`，离开时照旧停。
- 查的结果回来之前读者发的话等它（use-call 按线程记，课堂只有一个），回来后重走 `send`：有在途回合就插话；正在落盘时插话不被收下，留在 `unsent`，结算后写文件开新回合。
- 测试：`tests/reading/turn/durable-resumed.test.ts`（faux，4 个：空闲线程查不到且不建对话、接上后流式和插话且屏幕 ts 等于落盘 ts、停止保留半句、落盘中没有 run 时插话不收）；`tests/reading/session/use-call-resumed.test.tsx`（5 个，`fakeBookTurns()` 加了 `inFlight(after)` 和 `lookups`，打桩 `resumedBookTurn`）；`use-lesson-call.test.tsx` 加 2 个。全量 `scripts/t.sh` 7373 过、1 跳过、0 失败，`bun run typecheck` 过。

拍板的：

- 接上的回合就是读者自己的回合：结局（含失败行和 Retry）、停止、交回的插话都走 `finish`，不按铃的 visiting 处理。
- 空线程不查：回合总是从文件里的一句话开始。
- 接上的回合不挂停摆看门狗（没要求）。
- 坑号 520、521 没用上。

没做：

- 恢复时被 abort 的回合（正文中间）落盘只要几毫秒；读者恰好在那之间打开线程，`turn-rows` 会把文件里刚写的撤回插话行从屏幕上替换掉，结算后的屏幕也没有 `rp.partial` 的半句，重开线程才对。
- 真机和模拟器都没跑。

## 第八棒（分支 `dev/pi-durable-p1i`，从 `dev/pi-durable` 353bb754 起）

做了：

- `reading/turn/durable-turn.ts`：`runBookTurn` 里的看门狗提成 `watchTurn`（beat、hold、到点 supersede，回前台判死走共享的 `stallWatches()`），`resumedTurn` 的 `follow` 也挂它；`resumedTurn` / `resumedBookTurn` 多一个可选的 `{ watches, stallMs }`。被切的接上回合以 `stalled` 结束，use-call 和课堂按原来的 `afterStall` 重问一次（新装配的回合），第二次报失败。
- turn-log：`reading/turn/durable-turn-log.ts` 的 `BookTurnLog`，按线程 key 记，写 `start`（surface、`conversation` 为 threadId、provider、model、`held: false`）、`first-byte`、`round`、`end`，字段含义同 `legion/execute/turn-log.ts`。本进程起的回合在 `startTurn` 后写 `start`；没在本进程起的（恢复的）在本进程看到的第一个请求时写。请求时刻来自 extension 新加的 `requested`（`openDurable` 的 `onRequest`，`beforeRequest` 里算出轮次后调），`round` 挂在 `recordResponse`，`first-byte` 是线程 view 上这一轮第一次出现半句（按消息 timestamp 区分轮次），`end` 在 `onSettled` 和跟随方看到结算时各报一次、只写第一次，看门狗切过的记 `stalled`。没有 lane，不写 `queued`、`lane`。`openReadingDurable` 的 `log` 可换 sink，默认 `appTurnLog`。
- `recordLongestSilence`：看门狗停下时，开发构建记这一回合最长的沉默（surface 同 turn-log）并打 `[stall]` 那行，同旧路径。
- 测试：`durable-stall.test.ts` 三个停摆场景对「本进程起」和「重启后接上」各跑一遍（假时钟），并核 turn-log 的 `end`；加开发构建记最长沉默 1 个。`durable-turn-log.test.ts` 4 个（一回合的行序和单一 id、结局映射、faux 带工具的书回合、恢复回合从首个请求记起）。`use-call-resumed.test.tsx` 加 1 个（接上的回合被切重问一次、第二次失败）。全量 `scripts/t.sh` 7382 过、1 跳过、0 失败，`bun run typecheck` 过。

拍板的：

- 接上回合的看门狗从读者打开线程（`follow`）时起算。
- 坑号 520、521 没用上。

没做：

- 真机和模拟器都没跑。

## Linux 桌面验收（分支 `verify/pi-durable-linux`，从 `dev/pi-durable` 6cffd52f 起）

做法：独立 identifier `com.xinyuan.readingpartner.verifylinux`（`cargo build` 时 `TAURI_CONFIG` 覆盖 identifier 和 `devUrl`，不带 custom-protocol，二进制加载 dev server），vite 在 1437 端口跑，经 `scripts/sim-bridge.ts` 的通道在页面里执行脚本；`Xvfb :97` 虚拟显示，PIL 截图。凭据只拷用户 credentials.json 的 access 和 expires，refresh 填假值（Anthropic 换新会作废旧 refresh token，测试 app 刷新会把用户登出）；开始时用户的 token 已过期，等用户自己的 app 刷新后才拷到。驱动脚本和截图在会话 scratchpad 的 `verify-linux/`，报告页 `verify-linux/report.html`。

走到的：

- 正常回合（Haiku，不带思考，三轮含两次 `read_chapter`）：流式和结束都对，turn-log 有 start、每轮 first-byte 和 round、end，字段同旧路径。不带思考的首包 2402–2578 ms。
- 正文中间 SIGKILL：重启后不重问（没有新的 reading 请求），库里 `rp.partial` 有半句、`rp.turn` 结果 `landed: true`，但线程文件里没有半句，屏幕上只有读者那句。查出一处原因（坑 523，线程文件没加载时 append 被吞），修在 58ec415a；修后重测半句仍没进文件，还有别的原因没查明。下一步：在 `bookLander` 里打日志看 rows 和 `threads.messages(home, threadId)` 是否为 undefined（怀疑 home 和线程文件的 key 不一致，或 `getThread` 在 load 后找不到 threadId）。
- 重启后 app 自己发了一次 surface `subagent` 的 Haiku 请求（2773 入、153 出），来源没查。
- 库增长：第一回合（三轮）WAL 从 119 KB 到 2.39 MB，被杀的一回合约 +845 KB；WAL 没 checkpoint，偏大，不能直接当每回合字节数。

没走成（预算用完）：工具里杀、重启后在途回合的停止和插话、插话两种、停止、铃、带思考的首包。`stream.timeoutMs` 只能按不带思考的首包给下限：取 60 s 以上，带思考的要补测。

## 半句不落修复（分支 `fix/pi-durable-partial`，从 `verify/pi-durable-linux` aefa5c47 起）

「修了 523 仍不落」是验收环境的问题：worktree 里的 vite 不监听自己的文件（坑 403），58ec415a 写进去时 vite 开着，重启 app 跑的还是旧 lander。证据是线程文件 mtime 停在读者那句写盘时，重启后的落盘没写过文件。key 没有对不上：`rp.thread` 的 origin 是 `home = bookId = 文件名里的 hash`。

重起 vite 后在真 app（xvfb :98，同一个测试数据目录，驱动在 scratchpad `fix-partial/tools/`）里杀两次：经 sim bridge 把 `providers.anthropic.stream/streamSimple` 换成慢速 faux（`fix-partial/tools/faux.js`，只改那一页的内存），流到三百字时 SIGKILL，重启后线程文件里半句一次、屏幕上读者那句下面是半句、没有新的模型请求。全程没调真模型。

顺带：

- 被杀的回合重启后补 end：`onSettled` 带上 `rp.turn` 的 `startedAt`，本进程没开过的线程由 `BookTurnLog.endUnbegun` 写一行 end，带 `conversation` 和杀前那行 start 配对（turn id 是新的）。
- 重启后那次 surface `subagent` 的 Haiku 请求是记忆蒸馏（observations），把这条线程新增的三条消息蒸进 `observations/meta.json`，和回合恢复无关，不是新旧运行时重复处理。
- `durable-book.ts` 加 `storeBookThreads(store)`，app 的 `appThreads` 和测试共用这一个适配。


## iOS 模拟器验收

2026-10-10，分支 `verify/pi-durable-ios`（= `dev/pi-durable` 6cffd52f，没改代码）。iPhone 17 Pro 模拟器跑 `tauri ios dev`，包名 `.dev`，手机 EPUB 课堂，模型 claude-haiku-5-5，Haiku 请求 9 次。

- 正常回合过：首字节 1.2 到 1.6 s，600 词约 10 s。
- 正文中间杀进程不过：`rp.partial` 有半句，`rp.turn` 报 `landed: true`、submission 为 unanswered，线程文件里只有读者那句，Lumen 上多一张卡片。同 Linux 第 2 项。在 Thinking 中被杀则什么都不落，符合「一个字没写」。
- 插话进同一回合（turn-log 第 2 轮），行位置没截到；停止只测到 Thinking 中按停（无半句、无回执行），正文中停止待测。
- 切后台 30 s：原回合 `stalled`（36 s）后看门狗重问一次跑完；重问的回答先答了上一条被停掉、没有回答的问题。
- IPC（探针页直接从 vite 载入 .dev webview）：每次提交 p50 10 ms、p95 12 到 13 ms、max 17 到 18 ms，裸 IPC p50 0 ms、p95 1 ms；SIGKILL 恢复正确。crash 流 armed 后一秒内跑完，驱动要 0.1 s 轮询再杀。
- 库增长：基线 4 KB + WAL 117 KB；8 个书回合后主库 356 KB（约 45 KB/回合），WAL 4.0 MB 未 checkpoint。
- 没走：工具里杀进程、重启后打开在途回合、带工具轮的插话、手机 PDF 课堂（PDF 已铺进容器）。
- 环境：Mac `~/rp-flow` detached 在 6cffd52f，驱动脚本 `~/pdv.sh`，vite PID 在 `/tmp/pdv/devpid`。凭据只放 access token，refresh 是假值，过期后要从 Linux 再拷一次 access。

## Linux 桌面验收第二轮（分支 `verify/pi-durable-linux2`，从 `dev/pi-durable` 411c56b8 起）

除带思考首包外全用慢速 faux：未提交的脚手架在 `main.tsx` 最先 import，把 `providers.anthropic` 换成按 localStorage 计划出牌的 faux（启动时恢复的回合也走它），并包 `AssembledTurns.prototype.put` 给 desk 工具加延时。驱动在会话 scratchpad `linux2/`，报告页 `verify-linux/report.html`。Haiku 2 次。

- 正文中间杀、工具里杀（unsafe 得 interrupted 后接着说、safe 重跑）、重启后接上在途回合（在流、停止、插话、落盘中发话等结算）、两种插话、两种停止、三种铃都过；被停止且没回答的那句新旧路径都进下一回合，一致。
- 带思考（low）首包 2.9 / 3.9 s，屏幕第一个字 5.7 / 6.5 s；`stream.timeoutMs` 取 60 s。
- 修了 durable 工具目录漏登记 `statement_write`、`read_supplement`（坑 524）。
- 没修：`read_chapter` 按书有没有章节表是两种同名 schema，目录登记的是 `from`/`to` 那种，有章节的书 desk 收 `chapter`，每次 NaN。要定拆名还是合 schema。

## iOS 模拟器验收第二轮（分支 `verify/pi-durable-ios2`，从 `dev/pi-durable` 411c56b8 起）

2026-10-10，iPhone 17 Pro 模拟器，`~/rp-flow` 切到 411c56b8 后按 PID 杀掉上一轮的 dev server 重起，curl 确认 `durable-book.ts` 带 `load`。要抓时机的场景经 sim bridge 把 anthropic 换成慢速 faux（scratchpad `ios2/faux2.js`）；杀在工具中靠宿主侧轮询 durable 库（`ios2/killer.py`，坑 520）。真 Haiku 只用在工具中被杀后重启接着跑的那几轮，model-calls 记 4 次。截图和报告页在 scratchpad `verify-ios/`（`r2-*`）。

- 正文中间杀：过。半句一次进线程文件，屏幕上读者那句下面就是半句，重启后无模型请求；Lumen 卡片 +1（启动时没人在看这本书，按设计放卡片）。
- 工具里杀：过。`find_paper` 调用已提交、结果未提交时 SIGKILL，重启后工具重放、模型接着写完，回合 done，正文落盘。
- 重启后打开在途回合：看得到在流（Stop 在、工具行在），插话进同一回合（round 3）。停止没按成：第一次回合先跑完，第二次插话后 Stop 不见了（下条的 bug），按在输入框上。在途回合上的停止待补。
- 插话：纯文字和带 `read_pages` 工具轮各一次，插话行落在当轮正文之后、下一轮之前，回合多一轮跑完。修了一个 bug：手机 EPUB 课堂 `replyStreaming` 只看最后一行，插话的排队行一出来 Stop 就消失直到回合结束；改成跳过末尾的排队行（67be5583）。修后插话下 Stop 仍在，按下后半句留下、排队那句开下一回合。
- 停止：过。正文流中停止，半句留在线程和屏幕；带工具轮时工具回执行（trace）也留下。
- 手机 PDF 课堂、切后台：预算用完没走。退出重进 app 本轮做了五次，界面都回到首页、线程内容完整。
- 观察：重开线程时视图停在旧位置（看不到在流的那行，要点向下箭头）；工具轮插话后新发的那句没滚到上方。都未查。

## iOS 模拟器验收第三轮（分支 `verify/pi-durable-ios3`，从 `dev/pi-durable` 27a3a8fb 起）

2026-10-10，iPhone 17 Pro 模拟器。要抓时机的用慢速 faux：页面内的 `ios2/faux2.js`，加一个只在 Mac `~/rp-flow` 里、未提交的启动脚手架 `src/dev-faux.ts`（`main.tsx` 第一行 import；localStorage `__fauxPlan` 有值时从启动起把 anthropic 换成 faux，重启后恢复的回合也走它；源在 scratchpad `ios3/dev-faux.ts`）。真 Haiku 2 次。报告页 scratchpad `verify-ios/report.html`，页首有全部项的总表。

- 修了两个滚动问题（c2c36ed3）：插话句排在还在写的那一步下面，那一步继续长把它推出视口，现在发出的那句在读者滚动前一直钉在上方（`stick-to-bottom.ts` reveal 改为 hold）；重启后重开在途回合，运行时找到回合才画行，那次变化结束了开场，视图停在读者那句，现在「开场时最后一句读者话的回答晚到」仍算开场（`list-change.ts` 的 `answered`）。旧路径重开时在途的行和历史同一次渲染、落在在流那行，新路径现与之一致。
- 重启后在途回合上按停止：过。工具里杀、重启后工具重放、faux 接着写，正文中停止，半句进线程，回合 aborted。
- 切后台 30 s：过。Haiku 回合在后台继续流完（33.8 s done），回来无 stalled、无重问；第一轮那次 stalled 后重问没复现。
- 手机 PDF 课堂：预算用完没走。
- 环境：`~/rp-flow` detached 在 c2c36ed3，工作区有未提交的 `src/main.tsx` 一行和 `src/dev-faux.ts`；dev server PID 24214（`/tmp/pdv/devpid`）留着在跑。模拟器 app 里的凭据已删，下一轮要从 Linux 再拷 access token。

## 手机 PDF 课堂验收（分支 `verify/pi-durable-pdf-lesson`，从 `dev/pi-durable` e5222e29 起）

2026-10-10，iPhone 17 Pro 模拟器，idb 真触摸，PDF 是 Attention Is All You Need。`~/rp-flow` 的代码和 e5222e29 只差文档，没重起 dev server。全程用第三轮的启动脚手架跑慢速 faux（12 token/s，每段答案 40 句），没调真模型。截图和报告在 scratchpad `verify-ios/report.html` 的「手机 PDF 课堂」一节。五步都过，没改代码。

- 发问：首次点 PDF 出说明卡，Start the lesson 后课堂自动发开场问题，流式中 Stop 在，结束后 Stop 消失。
- 插话：标「after this step」、钉在上方；当前一步写完后同一回合接着答，正文顺序是上一步末尾、插话句、下一步。
- 停止：半句留在屏幕和线程文件。
- 流式中返回主题页再进：离开时半句已进线程文件，回来半句在读者那句下面，无 Stop、无新请求。
- 流式中 SIGKILL：重启进课堂半句只有一份，faux 调用 0 次（不重问），turn-log 补 end aborted；Lumen 盒子 +1（按设计）。
- 环境：dev server PID 24214 仍在跑；模拟器 app 里的凭据已删，localStorage `__fauxPlan` 已清（`src/dev-faux.ts` 脚手架仍在 `~/rp-flow` 未提交）。发送助手 `~/pdsend.sh TEXT`（按 DOM 取输入框和 Send 的位置再点）。

## iPad 真机验收（分支 `verify/pi-durable-ipad`，从 `dev/pi-durable` 885a54b4 起）

2026-10-11，iPad（iPad15,7，iOS 26.7.1）插 Mac mini。Xcode 26.6 的 CoreDevice 看不到这台 iPad（坑 521），全程走 pymobiledevice3：`apps install` 装 `.dev` 包（装前从 ipa 读回 CFBundleIdentifier），`apps afc` 铺书和取库，`dvt launch/kill/screenshot --userspace`，Homebrew 的 `ios_webkit_debug_proxy` 进 WKWebView 跑 JS。iPad 的 UDID 这次在门户注册了（坑 197，占一个年度名额）。慢速 faux 的启动脚手架提交为 `src/dev-faux.ts`，只有 `VITE_VERIFY_FAUX=1` 的构建带它，另加 `__fauxToolDelayMs` 让本进程组装的回合的工具变慢，好杀在工具里。iPad 竖屏下「Learn this book with AI」是整屏课堂（use-call）。报告页在会话 scratchpad `verify-ipad/report.html`。Haiku 0 次：Linux 上的 access token 已过期 13 小时。

- 正文中间杀：过。半句一次进线程文件，重开不重问；重启时有一次 `subagent` 调用（Lumen 卡片那条路），不是阅读回合。
- 工具里杀、重启后接上在途回合：过。`read_pages` 慢跑中 SIGKILL，重启后工具重放、faux 接着写，打开线程看得到在流、Stop 在；插话进队（after this step）；停止留半句，排队那句开下一回合。
- 插话与停止：过。正文流中插话，同一回合第 2 轮回答（turn-log 同一个 turn id）；第 2 轮正文中停止，半句留在线程（332 字符，断在词中间）。
- IPC（`scripts/durable-probe` 打成 `.dev` 包装到 iPad）：每次提交 p50 18 ms、p95 20、max 26；裸 IPC p50 0、p95 1、max 9；每次宿主调用 p50 2、p95 3。SIGKILL 恢复正确（半句 820 字符、待办 1 条、续写完整）。
- 库增长：本地 checkpoint 后主库 116 KB 起，10 个提交后 356 KB，约 25 KB/提交（faux 答案每段约 3.6K 字符）；设备上 WAL 涨到 4.0 MB 才 checkpoint，主库文件 316 KB。
- Haiku 正常回合（第二棒，access token 从 Linux app 拷，refresh 填假值，收尾已删）：过。首字节 3.0 s（thinking），正文约 12 s 后开始画，16.9 s 结束，`done`，3826 字符。开课没触发逐章 prep（失败章不自动重跑，overview 已 done）。
- 切后台（`dvt launch` 设置把 app 压下去，和按 Home 一样有「◀ Reading Partner」返回角标；`dvt launch --no-kill-existing` 叫回，PID 不变）：30 s、60 s 都在 Thinking 刚开始时切，离开期间 JS 冻结、流不前进；连接没死，回前台一秒内整段回答（3813、3652 token）画完，回合 `done`，看门狗没动作也没重问，turn-log 每回合一组 start/first-byte/round/end。线程文件 5 问 5 答，结尾完整、无重复段落。另两次切晚了（正文已出或回答短），回合在进后台后几秒的宽限里就写完了。离开超过 90 s 那种情况没量，见坑 522。
- 第二棒 Haiku 共 7 次：阅读回合 5 次，另有一次回前台时跑了 `subagent` 回合（2 次，Lumen 那条路）。
- 注意：课堂第一次打开会对每章跑一次 prep（这本书 63 章），走默认模型。真模型前要让 prep 已完成，否则一开课就是 63 次 Haiku。这次用快速 faux 跑完 prep，23 章失败（faux 队列耗尽，失败章不自动重跑），overview 手工标了 done。
- 观察：课堂内容滚上去后，左上角关闭/删除按钮压在正文上（截图 s3c）。
- 环境：Mac `~/rp-ipad`（worktree，detached 在 96caede7），构建 `~/build.sh`、设备助手 `~/d.sh`（launch/kill/shot/js/send/stop/st/open）、`~/rp.py`；ipa 在 `/tmp/rp-dev-ipad.ipa`，探针包 `/tmp/rp-dev-probe.ipa`。iPad 上 `.dev` app PID 7204（第二棒重起，去掉进程里残留的 faux）留着在跑，ios_webkit_debug_proxy PID 78195 在 Mac 上跑。容器里占位凭据已删，faux 的 localStorage 键已清，`settings.json` 三个模型都是 claude-haiku-5-5。

## 第二阶段第一棒（分支 `dev/pi-durable-2a`，从 `origin/main` 40a8c6a0 起）

做完的：

- 按 place 推广：`legion/durable/device.ts` 是设备运行时，`openDeviceDurable({ places })`，每个 place 给 `key`（`rp.conversations` 的键）、`address`（落进哪个线程文件的哪条线程）、`resolve`（桌面解析器）、`land`、`readHistory`、`telemetry`（surface、thread、bookId、inline）。共用的在这里：打开、`recoverBeforeResume`、撤回的 steer 按 place 写回文件（`fileWithdrawnSteers`）、`recordModelCall` / `recordCacheTurn`、turn-log、`onTurnSettled`。`legion/durable/thread-files.ts` 是通用的 `ThreadFiles`、`threadMessageOf`、`threadLander`（按 role+ts 跳过、flush 后放卡片、在看或拒绝或铃时不放、铃的 runId 盖章）、`fileSteers`。turn-log 从 `reading/turn/durable-turn-log.ts` `git mv` 到 `legion/durable/turn-log.ts`，类名 `DurableTurnLog`。
- 书那条路：`durable-book.ts` 的 `bookLander`、`storeBookThreads`、`threadMessageOf`、`bookUsageReport`、`bookCacheTurn` 改成通用件的薄包装，加 `bookPlace()`；`openReadingDurable` 组装 book place 后调 `openDeviceDurable`，`ReadingDurable` = `DeviceDurable` + `assembled`。`durable-turn.ts` 提出 `runPlaceTurn` / `resumedPlaceTurn`，`runBookTurn` / `resumedTurn` 委托给它；`book-turn-rows.ts` 加 `drivePlaceTurn` / `resumedPlaceRows`。书的测试一个没改断言。
- 门口：`soul/door-durable.ts` 是门口的 place。origin `{ place: "door", date, threadId }`，键 `door:<date>:<threadId>`，落进 `doorKey(date)` 那个文件（对话按归属存）。本进程装配的历史和工具放 `doorAssemblies`（模块级），重启后历史读文件（排除 `excludeTs`，丢空文字行），工具走 `openDoorTurn` 重新摆桌（没有界面那几个出卡片的工具）。没人开着门口对话时落盘放卡片，同 `soul/recover.ts` 的那张（`coverOf`，origin 是 door）；门口对话开着时用 `setDoorWatching` 登记。`soul/door-chat.ts` 加 `prepareDoorTurn`：同 `sendAtTheDoor` 的装配，交回 system prompt、读者那句（带链接的 app note）、工具、notice、talk 档模型和 `chatThinking`。
- `reading/turn/place-session.ts`：一条对话的回合控制器，不依赖 React，照第四、五棒 use-call / 课堂的做法：读者那句先进文件，占位行，装配，`drivePlaceTurn`，每次 view 替换那句之后的行；插话进 `unsent` 画 queued，`steer` 收下才去掉；结局 answered（最后一个 AI 行带 notice）、stopped（去空行）、refused / failed（另起失败行）、stalled（清行，`afterStall` 重问一次）；没被收下的话和撤回的 steer 按 ts 写文件，answered、stopped 后开下一回合；装配中停止删占位行、写 `unsent` 再开回合；`leave()` 停回合不再画（2026-10-11 起门口、info、三餐关对话改用 `detach()`，不停回合，见末节）；`resume()` 接上在途回合。`withPlaceTurnRows` 替换回合行时把回合中出的卡片行留在回合行上面。
- `use-door-chat.ts` 切到新运行时：不再用 `useStreamingTurn`，自己管行；打开时建 session、登记 watching、`resume()`，查完之前发的话等它；`send` 在回合进行中走 `say`（插话），否则写文件再 `ask()`；`raiseCard` 自己做（插在流式行前面，写文件）；卸载 `leave()`。`useBackgroundServices` 以 `startReadingDurable(appToolCatalog, () => ({ door: doorPlace() }))` 打开运行时。
- `take_link` 加进 `appToolCatalog` 和 tool-contract 的 ROSTER（unsafe、quiet）：不在目录里的工具会被 `runPlaceTurn` 静默滤掉。
- 测试：`tests/soul/door-durable.test.ts` 7 个（faux：落盘一次且历史用装配、停止留半句、插话进同一回合且回答另起一行、关着时放卡片、接上在途回合且历史读文件、空闲不接、卡片留在回合行上面），`tests/soul/door-kill.test.ts` 1 个（真 SIGKILL：半句进当天文件一次、不重问、放卡片、turn-log 补 end）。全量 `scripts/t.sh` 7452 过、1 跳过、0 失败，`bun run typecheck` 过。

拍板的（和 87 不一致或 87 没写的）：

- 87「分层」的表没有 `device.ts`、`thread-files.ts`、`turn-log.ts`，现在 `legion/durable` 多这三个文件。运行时的入口仍叫 `startReadingDurable` / `readingDurable`（在 `reading/turn/durable-runtime.ts`），别的 place 由外壳传进来；改名牵动几十个测试，没改。
- 门口接了插话：旧的门口在回合进行中发话直接 return。
- 关掉门口对话不停回合：回合在后台跑完落盘，落盘时没人开着对话就放卡片；只有按停止才停（2026-10-11 用户改定，原为「关掉 = 停止」，见末节）。
- 门口回合落盘时没人开着对话就放卡片（旧路只有恢复时放）。
- 门口的工具标签用本回合工具的 `toolLabel`（`catalogDescribe(request.tools)`），恢复的回合用目录的。

没做的：

- 真 app 验收（xvfb 下门口发问、停止、杀进程恢复）没跑，预算不够。Haiku 0 次。
- 第 3 项：`soul/headless.ts` 建 `rp.turn`、`soul/bell.ts` 非书分支改 `startTurn`。门口的铃仍走旧路（`openDoorTurn` + `sendHeadless` + held harness），和新运行时上的门口回合并存：两者不互相判忙，读者在门口对话里有回合时铃的回合会同时跑（旧路也是这样，门口没有 hold）。
- `use-door-chat` 没有 hook 层测试（只有控制器和 place 的）。`sendAtTheDoor` 和 `tests` 里它的测试留着，app 里已经不调。
- 已知边角：装配完、`drivePlaceTurn` 还没交回句柄的那几毫秒里按停止，下一回合会撞 `TurnBusy` 出失败行（书那条路同样）。

下一棒：

- 先做第 3 项：仿 `reading/turn/deliver.ts` 的 `deliverBookBell` 写门口（和之后每个 place）的 `TurnDeliverer`，`bell.ts` 的门口分支改走它（目标对话忙则等 `onTurnSettled`，重启按 `bellTurn` 不重投）；`headless.ts` 改成建 `rp.turn` 不等界面（铃和恢复是它仅有的调用方）。同时跑门口的 xvfb 验收（`VITE_VERIFY_FAUX=1` 的 `src/dev-faux.ts`）。
- info（`use-info-call.ts`、`voice-call-live.ts`、`info/briefer/deliver.ts`）、三餐、排练教练（`useCoach.ts`）、复述（`useRetell.ts`）各写一个 place（照 `door-durable.ts`）加用 `place-session.ts` 换调用，互相不碰文件，可以并行；冲突只在 `useBackgroundServices` 的 places 那一行和 catalog / ROSTER（没登记的工具会被滤掉，每棒先核一遍自己面上的工具名都在目录里）。铃的 `TurnDeliverer` 每个 place 一个，最好等第 3 项把门口那份写成样板后再并行。

## 第二阶段第二棒 C（分支 `dev/pi-durable-2d`，从 `origin/dev/pi-durable-2` 87ef3abf 起）

做完的：

- `reading/turn/one-thread-place.ts`：「一样东西一条线程」的 place 通用件（`oneThreadPlace`、`oneThreadTurn`），照 `door-durable.ts`：本进程装配的历史和工具放 assemblies，重启后历史读文件（排除 `excludeTs`、丢空文字行），桌面由 place 自己重摆；落盘用 `threadLander`，从不放卡片（旧路这两面也不放）。
- 排练教练 `reading/rehearsal/coach-durable.ts`：place 名 `talk`，origin `{ place: "talk", id: outlineId }`，键 `talk:<outlineId>`，落进 `talkThreadKey(outlineId)` 那个文件、线程 id 即 outlineId（存储格式不变）。重启的桌面从盘上的大纲重摆（`buildCoachTurn`，大纲工具照写，卡片不画）。`prepareCoachTurn` 交给 place session。
- 复述 `reading/retell/retell-durable.ts`：place 名 `retell`，键 `retell:<retellId>`，落进 `retellThreadKey(retellId)`。复述的每个回合都排在 kickoff 后面，kickoff 不是文件里的行：开场回合以 kickoff 为那句、不带 ts（不落盘）；重启后读文件的历史在前面补 kickoff（那句不在文件里时不补）。重启的桌面从盘上的复述、材料重摆，决定和讲稿工具照写。
- `ui/components/chat/use-place-chat.ts`：两面共用的薄包装（行、镜像 ref、卡片插在流式行前并写文件、`send` 回合中走 `say` 否则写文件再 `ask`、`resume`、离开时 `leave()`，或由面决定让回合在看不见处跑完并在落盘后回调）。`useCoach.ts`、`useRetell.ts` 换成它，不再用 `useStreamingTurn` / `runAgentTurn` / `soulHarness`。打开时先 `resume()`，接上了就不再问；教练没接上才按 `awaitingReply` 自动回答，复述没接上且对话为空才自动开场。
- `useBackgroundServices` 的 places 加 `[COACH_PLACE]: coachPlace()`、`[RETELL_PLACE]: retellPlace()`。两面的工具全在 `appToolCatalog` 里（读、图、课堂、复述、讲稿、soul 那几组都已登记）；`tests/reading/rehearsal/coach.test.ts`、`tests/reading/retell/turn.test.ts` 加了「本回合工具都在目录里」的断言。
- 测试：`tests/reading/turn/one-thread-place.test.ts` 8 个（两面各：落盘一次且历史用装配、停止留半句不重问、接上在途回合且历史读文件；复述开场以 kickoff 发出且文件只进回答；prepare 的拒绝和错形状），`tests/reading/turn/one-thread-kill.test.ts` 2 个真 SIGKILL（教练带 ts 的那句、复述开场无 ts：半句进文件一次、不重问、turn-log 补 end）。全量 `scripts/t.sh` 7462 过、1 跳过、0 失败，`bun run typecheck` 过。

和旧行为不同的：

- 回合进行中发话：旧路 `begin` 另起一个回合（旧的那个看不见地接着跑）；现在插进正在跑的回合（docs/72）。Composer 本来就允许回合中发送，没加新交互。
- 离开教练、或离开没开过口的复述 = 停止，半句落进文件（旧路 abort 丢半句），同课堂的决定（门口 2026-10-11 改成关掉不停，教练和复述不变）。开过口的复述离开时回合照旧在看不见处跑完，落盘后再蒸馏。
- 模型失败、卡死的样子跟 place session（失败行、卡死重问一次），不再是 `useStreamingTurn` 的。没配模型仍是原来的错误条，拒绝仍是拒绝行。
- 重启接上的回合里，工具出的卡片不画（行上的工具回执照记），桌面装配时 topicName 为空（只影响工具，不影响已在对话里的系统提示）。
- 模型仍用 `defaultModelId`（旧路如此），没改成门口那样的 `modelIdFor(settings, "talk")`。

没做的：

- 真 app 验收（xvfb 或模拟器上教练回答一遍、复述开场、停止、杀进程恢复）没跑；两面语音依赖重，留给统一验收。hook 层没有测试（只有 place 和控制器的）。
- 这两面没有铃（桌面不是 place，`assembled.origin` 恒空，旧路也从不传 `deliverTo`），铃投递不涉及。
- 实测没有踩到意外，531–533 没用。

## 第二阶段第二棒 B（分支 `dev/pi-durable-2c`，从 `origin/dev/pi-durable-2` 87ef3abf 起）

做完的：

- 三餐确实走 `use-info-call.ts`（`use-info-home.ts` 的 `setInfoCall(mealsAnchor(...))` 开 `InfoCall`），和 info 一起换。
- `info/briefer/info-durable.ts` 是两个 place。info：origin `{ place: "info", date, threadId }`，键 `info:<date>:<threadId>`（日期把每天文件里都重复的 `onboarding` 分开），落进 `infoBookId(date)` 文件的那条线程；meals：origin `{ place: "meals" }`，键 `meals:meals`，落进 `info-meals` 的 `meals` 线程。本进程装配的历史和工具放 `infoAssemblies`；重启后历史读文件（排除 `excludeTs`、丢空文字行），工具走桌面解析器：`deliver.ts` 拆出 `layBriefingTurn` / `layMealsTurn`，铃的 opener 和解析器共用（不挂出卡片的工具，`generate_briefing` 抛错），解析器把 BoxOrigin 传给 `assembleTurn`，恢复的回合里 `delegate` 照样回铃到原处。没人看时落盘放的卡片和 `soul/recover.ts` 同一张（boxId `<threadId>:<ts>`，origin `{ briefing, date }` 或 `{ meals }`）。`watchInfoConversation(key)` 登记在看。`prepareInfoTurn` 装配一个回合并把历史和工具放进 `infoAssemblies`，文本和以后的语音共用。
- `use-info-call.ts` 换成 `place-session.ts`：读者那句先写文件再 `ask()`，回合中发话走 `say()`（插话），Stop 留半句和回执，打开时 `resume()` 接上在途回合（查完之前发的话等它），看门狗和被杀恢复由运行时和控制器给。卡片照旧：`raiseCard` 插在流式行前并写文件，`withPlaceTurnRows` 的 keep 留住卡片行和本视图在回合中写的 note 行（briefing 进度卡、应用三餐计划后的说明卡、card gesture 的 note）。setup 开场照旧只在空线程、只开一次，`OPENING_KICKOFF` 作 prompt 发出，运行时不落 prompt 行，所以不进文件；kickoff 只进空线程。
- `appToolCatalog` 原来没有三餐的 8 个工具，换过来后会被 `runPlaceTurn` 全部滤掉。加了 `info/meals/tools.ts` 的 `buildMealsCatalogTools`，`live.ts` 和目录共用这一份清单；ROSTER 加 `info/meals` 行；「目录登记了 roster 每个名字」那条测试也查 companion 的工具名。info 面上其余工具（companion、source、soul 的）原来就在目录里，article 不带工具。
- `useBackgroundServices` 的 places 加 `info: infoPlace(), meals: mealsPlace()`。
- `place-session.ts`：停止和离开先等在途的 steer 提交完再调运行时的停止（坑 528），门口一起受益。
- 测试：`tests/info/briefer/info-durable.test.ts` 12 个（两个 place 各五个：落盘一次且历史用装配、停止留半句、插话进同一回合、接上在途回合且历史读文件、关着放卡片；另有键和地址、setup 开场只落 AI 的话），`tests/info/briefer/info-kill.test.ts` 2 个真 SIGKILL（两个 place 各一：半句进文件一次、不重问、放卡片、turn-log 补 end），`tests/ui/components/info/info-call-turn.test.ts` 改写成 hook 跑真运行时（faux）5 个（停止留半句且落盘一次、装配中停止不发、三餐落进 `info-meals`、插话进同一回合、和停止同一刻的插话写文件并开下一回合），`info-refusal.test.ts` 的源码守卫改查新路径。全量 `scripts/t.sh` 7466 过、1 跳过、0 失败，`bun run typecheck` 过。

拍板的（和旧行为不同）：

- 关掉 info / 三餐对话不停回合，同门口：回合在后台跑完落盘，cleanup 立刻撤 watching，落盘时没人开着就放卡片（2026-10-11 用户改定，原为「关掉 = 停止、停下的回合不放卡片」，见末节）。
- 没人看时落盘放卡片：被杀后恢复的回合于打开对话前落盘，和关掉对话后才落盘的回合。
- 恢复的 article 回合用当天 briefing 的桌，工具不缺（article 本来不带工具），只是不挂出卡片的工具。
- 三餐回合的 telemetry surface 仍是 `info`（旧路也是），thread 是 `meals`。
- info 对话仍不订阅 `onThreadMessage`（旧路也没有）：开着对话时铃落进来不即时显示，重开才见。

没做的：

- 真 app xvfb 验收（info 和三餐各一回合发问、停止、杀进程恢复）没跑，预算不够。Haiku 0 次。下一棒照第一阶段的做法跑：`VITE_VERIFY_FAUX=1` 慢速 faux，换代码后重起 dev server（坑 403）。
- 铃：`openBriefingDelivery` / `openMealsDelivery` 仍走旧 held harness，等 2b 的 `TurnDeliverer` 样板。新运行时上的 info 回合和铃回合不互相判忙。
- 书的两个界面（`use-call.ts`、`use-lesson-call.ts`）没走 `place-session.ts`，坑 528 的竞争还在。
- `useStreamingTurn` 现在只剩 `useCoach.ts`、`useRetell.ts`（2d 在换）和 `door-tools.ts` 的类型引用。

语音接这个 place 要做的（`info/briefer/voice-call-live.ts`）：

- 每句转写照旧 `appendMessage` 进线程，记下它的 ts；用 `prepareInfoTurn({ anchor, key: bookId, dateKey, signal, messages, companionTools: opts.tools })` 装配（不给 mealsTools，通话只锚在某一天），`line` 带那句的 ts，`excludeTs` 才对得上。
- 用 `drivePlaceTurn` 或 `runPlaceTurn` 的 `onView` 跟回合：从 TurnView 的流式文字取增量喂合成（今天的 `onDelta`），工具起止喂 `onActivity`；`ended` 是 answered / refused 时 resolve，failed reject。打断（barge-in）调 `stop()`，半句落盘。
- 语音和文本是同一个对话键：语音回合进行中，文本那边发话会成插话；两边各自 `startTurn` 会撞 `TurnBusy`，语音那边要先问 `turnInFlight` 或干脆复用一个 `PlaceSession`。

## 第二阶段第二棒 A（分支 `dev/pi-durable-2b`，从 `origin/dev/pi-durable-2` 87ef3abf 起）

做完的：

- 通用的铃投递 `reading/turn/place-bell.ts`：`deliverPlaceBell(input, place, deps)`。先 `bellTurn` 按铃 id 找已起的回合，有就等它、从线程文件按 runId 取回复，不重投；然后循环：该对话有打开的 place session 且在跑（读者回合在装配、在跑或在落盘）就 `onWait` 并等 `session.idle()`；装配；开着对话就 `session.bell(after, request)` 在那个 session 里跑（流式、能停、能插话，插话由 session 照常落文件、开下一回合），没人开着就 `headlessPlaceTurn`（`drivePlaceTurn` 不画行，带停滞看门狗）；撞 `TurnBusy`（重启后恢复的回合、别的铃的回合）就等该对话的 `onTurnSettled` 再来。结局同 `deliverBookBell`：answered、停下且有 AI 行算 answered、停滞和失败算 failed（铃留着下次投）。
- `place-session.ts` 加 `bell()`、`idle()` 和打开登记 `registerOpenSession(key, session)` / `openPlaceSession(key)`。铃的回合在 session 里停滞不重问、失败不出失败行。登记是显式的，界面开对话时登记、关时撤（隐式登记会让没 `leave()` 的测试 session 串到下一个测试文件）。
- 门口：`reading/turn/door-bell.ts` 的 `deliverDoorBell` + `registerDoorDelivery()`（外壳 `useShellBootstrap` 里和书的一起注册）。当天门口那条对话（`openDoorThread`），`prepareDoorTurn` 以文件里的历史加铃为输入装配（不带界面那几个出卡片的工具），surface `bell`。`use-door-chat` 打开时 `registerOpenSession`。`soul/door-durable.ts` 导出 `doorWatchingNow`。
- `soul/bell.ts`：投递那段抽成 `byTurn(deliver, place, cardOrigin)`，place 分支和门口分支共用（忙则这只铃单独等、同对话后来的铃排在它后面、落盘后才 delivered、ack、markDelivered）。门口分支：没有 place 接住（无 origin、wake、opener 返回 null）且注册了门口 deliverer 就走它，place 是 `{ place: "door", date: 今天 }`，卡片的 origin 仍是 run 原来的地方。wake 铃也走它（`TurnDelivery.runId` 改成可选，wake 不放卡片、不 markDelivered）。
- 测试：`tests/reading/turn/door-bell.test.ts` 4 个（faux：没人开着时 headless 落盘一次带 runId、同一只铃再投不起新回合；读者回合在跑时铃等落盘后在 session 里流式出现；session 里停下留半句；插话进铃的回合）；`tests/soul/bell.test.ts` 加 1 个（门口 deliverer 接住无处可去的铃和 wake 铃，卡片只给 run）。`bell.test.ts` 的 `beforeEach` 撤掉别的测试文件留下的门口 deliverer。全量 7457 过、1 跳过、0 失败，typecheck 过。

真 app 验收（Linux，`xvfb-run` 同款的 Xvfb :96，复用 `verifylinux` identifier 的 debug 二进制加载本 worktree 的 vite 1437，`VITE_VERIFY_FAUX=1` 慢速 faux，测试 AppData 先挪成 `.bak-2b-*` 再新建，凭据是占位值、用完删）：

- 发问流式、插话进同一回合（第二次模型调用接着答）、停止留半句：过（截图 01–03）。
- 正文中 SIGKILL 重开：线程文件里读者那句下面半句一次（312 字），重启后模型调用 0 次：过（04）。
- 门口开着且空闲时铃：回合在打开的对话里流式出现，落盘带 runId，铃清空：过（05、06）。
- 读者回合在跑时铃：铃保持 queued、模型调用只多读者那一次；读者回答落盘后铃的回合才起，文件顺序是 读者那句、读者回答、铃的回答：过（07、08）。
- 重启不重投：重启后模型调用 0 次，两只铃各只有一条回复：过（09）。
- 没走：工具里杀进程后重启接上在途回合（门口工具没有慢速包装，`__fauxToolDelayMs` 只包书的 `AssembledTurns`）。单测有（第一棒 door-durable「接上在途回合」）。
- 截图和驱动在会话 scratchpad `verify-door/`（`tools/vd.py`、`tools/run.py`、`log-*.json`）。Haiku 0 次。

拍板的：

- `soul/headless.ts` 没有改成建 `rp.turn`：它的两个调用方是 `recover.ts`（续旧 soul session 的 held 运行，第四阶段删）和 `bell.ts` 里还走 `deliveryOpener` 的 place（简报、三餐，等 2c 搬走），都不是新回合。铃的 headless `rp.turn` 是 `place-bell.ts` 的 `headlessPlaceTurn`；放 `reading/turn` 是因为 `reading/turn` 已经 import `soul`，反过来就成环，且停滞看门狗在 `reading/turn/durable-turn.ts`。
- 门口铃的回合在读者开着的对话里跑时，关掉对话不停它，回合跑完落盘后铃照常 delivered（同读者回合，2026-10-11 用户改定，原为「关掉 = 停止」）；按停止时有半句就算 answered。
- 门口的旧路（`openDoorTurn` + `sendHeadless` + held harness）只在没注册门口 deliverer 时走，app 里注册了就不会走；`bell.test.ts` 里门口那批旧测试靠它。删它和删 `soul/harness.ts` 回合入口一起做。

别的 place 接铃投递：

1. 写 place 的 `PlaceBell`：`key`（`rp.conversations` 的键）、`origin`、`address`（回复落进的线程文件 key 和 threadId）、`assemble(bell, signal)`（把历史和桌面工具放到 place 的 `readHistory` / `resolve` 找得到的地方，返回 `PlaceBellAssembly` 或 `{ failed }`，没东西可答返回 null）、`watching()`。照 `door-bell.ts`，deps 用 `appPlaceBellDeps(readingDurable)`。
2. `registerTurnDelivery("<place>", …)` 在外壳 `useShellBootstrap` 注册；`bell.ts` 不用改（有 turn deliverer 的 place 自动走 `byTurn`）；该 place 的 `registerDelivery` opener 留着，`recover.ts` 收尾旧 session 还要用。
3. 界面开对话时 `registerOpenSession(key, session)`，关时撤销，铃的回合才会在打开的对话里流式出现。
4. 测试照 `tests/reading/turn/door-bell.test.ts`；`bell.test.ts` 的 `beforeEach` 里同样撤掉该 place 遗留的 deliverer。

## 第二阶段第三棒 A（分支 `dev/pi-durable-2e`，从 `origin/dev/pi-durable-2` 011b9dd3 起）

做完的：

- `reading/turn/info-bell.ts`：`deliverInfoBell` 把 `{ briefing, date }` 的铃投进当天文件的 `briefingThreadId(date)` 线程（info place，键 `info:<date>:<threadId>`），`{ meals }` 的铃投进 `info-meals` 的 `meals` 线程；线程不在就建（launch card 委派的 run 可能先于任何对话回来）。装配用 `layBriefingTurn` / `layMealsTurn`（不带出卡片的工具），历史取线程文件经 `replayableHistory`，铃作最后一条 user，装配结果放进 `infoAssemblies` 供 place 的 `readHistory` / `resolve` 用；模型对话档、surface `bell`。`registerInfoDelivery()` 在 `useShellBootstrap` 里注册 briefing 和 meals 两个 turn deliverer，旧 opener 照旧注册给 `recover.ts`。`info-durable.ts` 导出 `infoWatchingNow`。
- `use-info-call.ts` 只改了打开登记那几行：建 session 后 `registerOpenSession(key, session)`，和 `watchInfoConversation` 合进同一个 `unwatch`，关掉时随它撤（2026-10-11 起关掉即撤，不等在途回合落盘，见末节）。
- 测试：`tests/reading/turn/info-bell.test.ts` 7 个（简报铃没人看 headless 落盘一次带 runId、铃不进文件、重开数据库后同一只铃不重投；三餐铃落进三餐线程；简报对话忙时铃等落盘后在 session 里流式出现；简报忙时三餐的铃不等；开着的三餐对话里铃的回合能停、留半句；插话进铃的回合；别处的铃返回 null）。`bell.test.ts` 的 `beforeEach` 撤掉 briefing、meals 遗留的 deliverer。全量 7488 过、1 跳过、0 失败，typecheck 过。

真 app 验收（Linux，Xvfb :96，复用 `verifylinux` identifier 的 debug 二进制加载本 worktree 的 vite 1437，`VITE_VERIFY_FAUX=1` 慢速 faux，测试 AppData 先挪成 `.bak-2e-*` 再新建，凭据占位值、用完删；写一个 disabled 的 `info-sources.json` 让 Today 出 launch card，「Tell the companion」打开当天简报对话）。Haiku 0 次。

- info：发问流式、插话进同一回合（第二次模型调用）、停止留半句 140 字；正文中 SIGKILL 重开，半句 176 字一次、重启后模型调用 0 次：过。
- info 的铃：对话开着且空闲时铃的回合在对话里流式出现（停止键在），落盘带 runId，铃清空；读者回合在跑时铃保持 queued，读者回答落盘后才起，文件顺序 读者那句、读者回答、铃的回答；重启后模型调用 0 次，两只铃各一条：过。
- 三餐没走成：桌面上三餐对话的入口在 onboarding 问卷之后，Lumen 菜单的 Text 打开的是门口；预算不够走完问卷。三餐的投递和 info 同一条 `deliverPlaceBell`，单测覆盖了空闲、开着时停止、和简报互不等。
- 截图和驱动在会话 scratchpad `verify-info/`（`tools/vd.py`、`tools/run2.py info|meals ask kill bell`、`log-info-*.json`）。

拍板的：

- `info-bell.ts` 放 `reading/turn`，不放 `info/briefer`：info 目前不 import reading，`place-bell.ts` 在 `reading/turn`，反过来要加 info → reading 的边。
- 铃的回合用对话档模型（同门口铃和旧 headless 路）。
- `layBriefingTurn` / `layMealsTurn` 带上铃的 BoxOrigin，铃的回答里再委派的 run 回到同一处（旧 opener 没传）。

没做的：

- 三餐的真 app 验收（一回合发问、插话、停止、杀进程，以及铃）。要先在测试 AppData 里铺一个带 charter 的 `meals` 状态文件跳过问卷，或走完问卷；然后三餐页的 ask 入口打开对话，`run2.py meals ask kill bell` 可直接用（`open-meals.js` 要改成点那个入口）。

## 第二阶段第三棒 B（分支 `dev/pi-durable-2f`，从 `origin/dev/pi-durable-2` 011b9dd3 起）

做完的：

- `reading/turn/info-voice.ts` 的 `infoVoiceThread` 交出语音通话的两个口（model、transcript），回合走 info place。放在 reading/turn：要用 `place-session.ts`，而 reading/turn 已依赖 info/briefer（2e 的 `info-bell.ts`），反过来成环。`voice-call-live.ts` 改成由调用方传 `thread`（`LiveVoiceCallOptions.thread`），`use-voice-call.ts` 传 `infoVoiceThread`；`threadTranscript`、`askOnThread` 删掉。`companion-live.ts` 只接工具，不跑回合，没动。
- transcript 只写读者的句子（带 ts，识别补全照旧按 ts 改那条），回答由运行时落盘。状态机记下的"听到的部分"（打断处截断、带 `INTERRUPTED_MARK`）在回合落盘后按 ts 改写落盘的行（`heardRows`：截点所在行截短加标记，截点之后的行清空文字）。下一回合的历史读文件，模型看到的仍是读者听到的，同旧路。
- 每次 view 的回答行拼成一条流（行之间加换行），增长部分喂合成；工具按（行 ts，序号）跟起止喂 `onActivity`，起止成对。
- 回合去处：对话有打开登记的 session（`openPlaceSession(key)`）就走新加的 `session.voice()`，同铃的 guest 回合（结局交给发起方，卡死不重问，失败不出失败行），另把语音那句画在回合行前面（坑 530）；session 里读者自己的回合在跑就先等 `idle()`；没人开着就 headless `drivePlaceTurn`，之后打开对话时 `resume()` 接上它。打断就是停这个回合，半句落盘。
- 一通电话的回合串行：下一回合等上一回合落盘、改写完再读历史（坑 529）。
- 回合进行中登记 `watchInfoConversation(key)`：读者在听，落盘不放盒子卡片（不登记时每句回答都放一张，测过）。
- 被杀：旧路是 soulHarness 的 held 运行，重启时 `soul/recover.ts` 续，正文中被杀则读回半句落到原处、放卡、不重问。新路由运行时恢复，同 info 文本：半句落一次、没人开着时放卡、不重问、不出声。
- 测试：`tests/reading/turn/info-voice.test.ts` 6 个（流喂合成且三条各落一次、历史用文件且不放卡；写进已有线程；打断后落听到的部分且下一回合接着答；开着的对话里打字进语音回合、回答也念出、对话画出整通；流和工具起止的拼法；听到的部分映射到行），`info-voice-kill.test.ts` 1 个真 SIGKILL（半句一次、不重问、放卡）。旧 `tests/info/briefer/voice-transcript-thread.test.ts` 删掉，用例并进新文件。

和旧行为不同的：

- 模型用 `modelIdFor(settings, "talk")`（同文本对话），旧路是 `defaultModelId`。有运行时的停滞看门狗，卡死时这句语音 failed，不重问。
- 回答是运行时写的：带工具回执的 trace，工具前后的话分成几行；旧路是一整条纯文本。
- 文本对话开着时，语音回合在对话里流式出现，打字成插话，插话的回答也念出来；关掉文本对话不停语音回合，回合归通话管，挂断才停（2026-10-11 用户改定，原为「关掉对话会停掉在跑的语音回合」）。

没做的：

- 文本对话开着且空闲时语音进它的 session，依赖 2e 在 `use-info-call.ts` 里加的 `registerOpenSession`；本分支没有，单独合入时这种情况语音 headless 跑，对话里打字撞 `TurnBusy` 出失败行。合了 2e 才完整。
- 语音回合撞上没有 session 的在途回合（铃的 headless 回合、重启后恢复的回合）报 `TurnBusy`，这句 failed、回到听，不等。
- 开着的对话不知道"听到的部分"的改写，重开才见。
- 真机/模拟器上要验：① 开场白念完、问一句、回答念出，对话文件里各一次，盒子无卡；② 开场白或回答中插话，念到的那句截断带标记，下一句正常回答；③ 通话中打开 info 文本对话，在说的回合接上流式出现，打字成插话且回答被念出；④ 合 2e 后文本对话开着时开通话，语音句子和回答画进对话，关对话时语音回合停下；⑤ 回答中杀 app，重开后半句一次、不出声、一张卡；⑥ 工具调用时 Lumen 低头；⑦ 挂断后蒸馏照旧。
- 坑 531 没用。

## 第二阶段第四棒 A（分支 `dev/pi-durable-2g`，从 `origin/dev/pi-durable-2` 1558f8d1 起）

做完的：

- 删 `soul/harness.ts`（`soulHarness`、`startSoulSession`）、`soul/headless.ts`、`soul/door-chat.ts` 的 `sendAtTheDoor`、`ui/components/chat/useStreamingTurn.ts` 和 `streaming-turn.ts`（已无调用方）及两份测试、`tests/support/scripted-runner.ts` 的 `scriptedBellSender`。`door-chat.ts` 只剩 `prepareDoorTurn`。
- `soul/bell.ts` 删掉旧路：opener 加 held harness 的回合（`openDelivery`、`send`、`landReply`、`hold`）和没注册门口 deliverer 时的门口回合。现在 place 有 turn deliverer 就走它，返回 null 或没有就走门口的 deliverer，门口也没注册就 `onTrouble` 并停这一轮（铃留在队列）。`AnswerBellDeps` 去掉 `harness`、`send`、`newThreadId`，`BellTurn`、`SendBellTurn` 删掉。
- `runAgentTurn` 不再收 `deliverTo`，app 里没有写 `DELIVERY_ENTRY`、`PROMPT_ENTRY` 的路了。`runHarnessTurn` 的 `deliverTo` 留着：`recover.test.ts`、`recover-settled.test.ts` 靠它造带戳的旧 session。
- 收尾旧 session：原来靠 `startSoulSession` 每次启动开 soul 的 held harness（开的时候顺带恢复，再新建一个 session 文件）。换成 `recover.ts` 的 `finishOldSoulSession`（`useBackgroundServices` 调）：列 soul 的 session 组，空就返回、不写任何东西；有就 `holdHarness` 开一次，等 `recoverSoulSession` 跑完，关掉，删掉组里所有 session 文件。没配 provider 或开不了就 warn，组留着下次再试。`sendHeadless` 并进 `recover.ts` 的 `appSend`，行为不变（talk 档、surface `recovery`）。
- 测试：`bell.test.ts` 改成脚本化的 turn deliverer（门口和书），旧 opener/hold 的用例删掉，加「没注册门口时铃留在队列」「书没了改投门口、卡片仍指书」；`tests/info/briefer/deliver.test.ts` 改成直接调 opener（recover 用的那份）；`door-chat.test.ts` 改测 `prepareDoorTurn`；`harness.test.ts` 删掉，`recover.test.ts` 加三个：旧 session 里 info 回合和门口回合各卡在工具里，第一次启动 info 回合被续完落进简报线程、门口回合 abort、模型只调一次、整组删掉，第二次启动什么都不开不写；没有 soul session 时不读设置不写盘；开不了时不抛、组留着。全量 `scripts/t.sh` 7457 过、1 跳过、0 失败，`bun run typecheck` 过。
- 87「第二阶段」补了已完成和与原计划不同的地方；55「execute」那段、71「对话按归属存」里 session 那段各加一句指向 87。25 的「契约」是第三阶段（子 agent）的事，没动。

留着的（第四阶段删）：`soul/recover.ts`、`soul/landing.ts`（只剩 recover 用）、`legion/execute/held.ts`，`soul/delivery.ts` 的 opener 注册（`registerDelivery`、`deliveryOpener`、`Delivery`、`DeliveryHold`）和书、简报、三餐的 opener，`DELIVERY_ENTRY` / `PROMPT_ENTRY` 常量。子 agent、后台 pass、agent worker 用的 `legion/execute` 没动。

没做的：

- 真 app 验收没跑：这一棒不改界面行为，升级收尾只有单测。要验的话：用旧版 app 在门口或 info 回合正文中杀进程，换本分支启动，看 info 回合落一次、AppData `session/--session-soul--/` 变空，再启动不新建文件。
- `tests/info/briefer/handoff.test.ts` 单独跑会挂（"collect" 这个 kind 没人注册，`electFor` 返回 null），全量跑过。和本棒无关，是测试顺序依赖，没修。
- 实测没有踩到意外，531–533 没用。


## 第二阶段第四棒 B（分支 `dev/pi-durable-2h`，从 `origin/dev/pi-durable-2` 1558f8d1 起）

Linux 真 app 验收三餐、复述、排练教练（Xvfb :96，`verifylinux` identifier 的 debug 二进制加载本 worktree 的 vite 1437，`VITE_VERIFY_FAUX=1` 慢速 faux，测试 AppData 先挪成 `.bak-2h-*` 再新建，凭据占位值、用完删）。没调真模型，没发现产品 bug。截图、报告页和驱动在会话 scratchpad `verify-phase2/`（`report.html`、`tools/`、`log-*.json`）。

- 三餐：测试 AppData 铺一个 version 2、带 charter、没有周计划的 `info-meals.json` 就跳过问卷，三餐页点「Ask about this week」开对话（`tools/open-meals.js`）。发问流式、插话进同一回合、停止留半句、正文中杀进程重开半句一次且重启后模型调用 0 次、铃空闲时在对话里流式且落盘带 runId、读者回合在跑时铃等落盘、重启不重投：都过。工具里杀进程：读类 `search_conversations` 重启后重跑、接着写完；写类 `add_shopping_items` 不重跑，回执 interrupted 错误、模型接着答，这是 pi-durable 的 `replay` 策略（坑 534），三餐八个工具都是写类。
- 复述：页内 `createTopic` / `createRetell(topicId, [])` / `talkOutlineForRetell` 建记录（`tools/seed-talk.js`），主题页 Retell 点那一行。开场回合自动起、停止留半句（kickoff 不进文件）、正文中杀进程半句一次不重问、工具里杀进程（`read_retell_outline`）重跑接着写、恢复的回合读文件历史时 kickoff 在最前（`window.__fauxContexts` 核对）、开过口后离开回合在看不见处跑完，回来接上在途回合继续流式、落盘一次：都过。重启后 `__fauxCalls` 多一次是启动蒸馏，不是复述回合（坑 536）。
- 教练：主题页 Rehearsal 那一行点「How it went」进教练，不经过说一遍。回答一遍、停止留半句、正文中杀进程半句一次且重启后 0 次、工具里杀进程（`read_talk_outline`）重跑接着写：都过。离开 = 停止（2d 的决定），半句落盘，再进不重问；教练没有离开后的在途回合可接。
- `src/dev-faux.ts`：`__fauxToolDelayMs` 也拖慢 `infoAssemblies`、`retellAssemblies`、`coachAssemblies` 里的工具；新增 `window.__fauxContexts`（每次调用发出去的消息的角色和开头）。工具里杀进程前要把 `__fauxPlan` 改成 `["text"]`，否则新进程的 faux 从第一步重来（坑 535）。
- 没走：排练的说一遍（要麦克风和转写）。教练、复述的铃（这两面没有铃）。
- 全量 `scripts/t.sh` 7493 过、0 失败，`bun run typecheck` 过。坑 534–536 用了。


## 书界面的插话竞争（分支 `dev/pi-durable-2j`，从 `origin/dev/pi-durable-2` e631ea00 起）

坑 528 在书的两个界面上的修法。`reading/turn/steer-gate.ts` 的 `gateSteers` 包住 runtime 的句柄：记下还在提交中的 steer，停止等它们都返回再调 runtime 的 stop；没有在途 steer 时停止立刻发出。`session/use-call.ts`（手机 EPUB 课堂经 `use-book-lesson.ts` 也走它）和 `phone/lesson/use-lesson-call.ts` 拿到句柄时各包一层，停止、离开、删线程都经过它。`place-session.ts` 没动。测试的假 book turn（`tests/support/use-call.ts`）照 runtime 建模：steer 晚一个 microtask 进 inbox，第一次停止时记下 inbox 快照（`withdrawn`）。`use-call-steer.test.tsx`、`use-lesson-call.test.tsx` 各加一个「插话后同一刻停止」的用例（不修时红），`steer-gate.test.ts` 三个单测。

## 第二阶段：关对话不停回合（分支 `dev/pi-durable-2i`，从 `origin/dev/pi-durable-2` e631ea00 起）

2026-10-11 用户改定：关掉门口、info、三餐对话不等于停止，只有按停止才停。回合在后台跑完、照常落盘；落盘时没人开着这个对话，就放 Lumen 的盒子卡片（`doorPlace` / `infoPlace` 的 `card`，原来只有恢复的回合走到）。排练教练、手机课堂关掉仍是停止；复述开过口后本来就继续跑，不动。（同日后来统一：教练、复述、手机课堂关掉也不停，见文末「关对话不停回合（统一）」。）

做了什么：

- `place-session.ts` 加 `detach()`：给在途回合打 `gone`，之后不画（`draw` 见 `gone` 就返回）、不报 streaming、结算时只把没被收下的话写文件，不开下一回合。不停运行时，装配中的回合照样装配完、起跑。`leave()` 留给 `use-place-chat`（教练、没开口的复述）。
- `use-door-chat.ts`：cleanup 由 `leave()` 改成 `detach()`，撤 `registerOpenSession` 和 `setDoorWatching`（原来就是立刻撤）。
- `use-info-call.ts`：cleanup 改成 `detach()` 加立刻 `unwatch()`（撤 `registerOpenSession` 和 `watchInfoConversation`），删掉「等 `onTurnSettled` 再撤 watching」那段。
- 再打开对话时新 session 的 `resume()` 用 `turnInFlight` 接上同进程里还在跑的回合（原来只碰到重启后恢复的），老 session 也还跟着它到结算，两边都不重复写文件：撤回的 steer 只回给调 `stop()` 的那个。
- 铃的回合、通话中的语音回合跑在打开的 session 里时，关文本对话同样只 detach：铃落盘后照常 delivered，语音照常念完，挂断（`GuestTurn.stop`）照旧停。
- 87「第二阶段」加一条；本文第一棒、第二棒 A/B、第三棒 A/B 的相反拍板句改成新规矩并注明日期。

测试：`door-durable.test.ts`、`info-durable.test.ts`（info、三餐各一）加「关掉后回合不停：再开接上、再关后落盘一次、放卡片、老屏不再画、不重问」；`info-call-turn.test.ts` 加 hook 层同一条（卸载、重开接上、再卸载，落盘一次带卡片）；`info-voice.test.ts` 加「通话中关文本对话，语音回合念完、落盘一次」。原来没有「关掉 = 停止」的单测可改，都是新加的。全量 `scripts/t.sh` 7462 过、1 跳过、0 失败，`bun run typecheck` 过。坑 540、541 没用到。

没做、已知边角：

- 关掉后回合答完时还有没被收下的话（来不及 steer 进去的），写进文件但不开下一回合：开回合要装配，装配读的是已卸载 hook 的 `messagesRef`，是旧的。在后台停摆同理，不重问，读者那句留在文件里没有回答。
- 关掉后、回合还在装配时（`drivePlaceTurn` 没交回句柄前）重开，新 session 的 `resume()` 查不到，回合在后台跑完落盘，重开的屏幕要靠 store 的追加通知才看到回答（没测）。
- 重开接上时同一回合有两个停摆看门狗（老 session 和新 session 各一个），都会在停摆时 supersede；没实测重复 supersede 会怎样。
- 真 app 验收（xvfb 或模拟器上门口、info、三餐各关一次对话看卡片、重开接上）没跑。

## 第二阶段 iOS 模拟器验收（分支 `verify/pi-durable-2-sim`，从 `origin/dev/pi-durable-2` f425983f 起）

2026-10-11，iPhone 17 Pro 模拟器，idb 真触摸，`~/rp-flow` detached 在 f425983f，dev server 带 `VITE_VERIFY_FAUX=1`（仓库里的 `src/dev-faux.ts`，12 token/s、每段 20 句）。没改代码。驱动在 Mac `/tmp/pdv2/`（`p2.sh`、`flow.sh`、`surface.sh`、`bell.sh`、`seed.py`），源和报告页在会话 scratchpad `verify-phase2-sim/`。真 Haiku 2 次。

- 门口：发问流式；插话标「after this step」钉在上方，进同一回合第 2 轮；停止留半句（244 字）；流式中关掉，回合跑完落盘一次，盒子 5→6，卡片 origin `door`；关掉再开，在流的行接着长、Stop 在、落盘一次、不出卡片；正文中 SIGKILL，重启后 faux 0 次，半句一次进文件，盒子 +1。
- info（主页「Tell the companion」进简报线程；要铺一个 `feed` 源，否则卡片只说没源）、三餐（铺带 charter 的 `info-meals.json`、`settings.meals`）：同门口六项都过。两处关闭键都是「Hang up」。三餐的插话进了同一回合第 2 轮，停止另测一次（324 字半句）。
- 铃（info）：空闲时投，铃回合在打开的对话里流式，落盘带 runId；读者回合在流时投，读者回合落盘后铃回合才起；重启后 turn-log 无新 start、faux 0 次、runId 不重复。`__bell.ring` 的 `deliverTo` 要 JSON 字符串，传对象会当作没写、投到门口（第一次这样投了两只，落门口带卡片，行为正确）。
- 书（手机 EPUB 课堂）：插话后停止，被撤回的那句开下一回合；回合中插话又停止，最后那句留在线程文件末尾。「插话后几百毫秒内停止」那次 idb 的停止点没打中（键盘弹着时按钮位置变了），回合照常把插话当第 2 轮答了，没测到真正同一刻的竞争，那条仍只有单测。
- 卡死检测重复（「关对话不停回合」第 3 条）：没写复现单测，预算不够。读代码：`place-session.ts` 的 `settle` 对 `gone` 的老 session 在 `start` 之前返回，重问只会由新 session 发一次；但 `deps.file(owed)` 在 `gone` 判断之前，两边都拿到撤回的插话时可能写两遍，没验证。
- 升级收尾：容器里有第一阶段留下的 5 个 soul session。没配凭据的第一次启动不动它（组留着，符合设计）；放进凭据后的第一次启动把组删空（目录还在、0 个文件），faux 0 次，说明没有在途回合要续；之后十几次重启目录一直是空的，worker session 没被碰。切代码那一刻踩了坑 537，旧 dev server 的那次重启用新源码跑过一次，组当时还在。
- 真模型 claude-haiku-5-5：门口首字节 1.62 s、全程 5.3 s；info 首字节 1.81 s、全程 5.3 s。
- 观察：杀进程恢复后 turn-log 的 `end aborted` 行和同回合 `start` 行的 turn id 不同（门口、info、三餐都这样），没查。重开对话时视图停在旧位置、出「Jump to latest」，与「对话不自动跟随」一致。
- 没走：排练、复述、语音、iPad 模拟器（下一棒）；工具里杀进程（本轮 faux 计划只有 text）。坑 538、539 没用。
- 环境：dev server PID 12428（`/tmp/pdv2/devpid`）留着在跑，旧的 24214、24327 已杀；模拟器 app 里的凭据已删、`__fauxPlan` 已清；`~/rp-flow` 工作区干净（只有原来就有的 `plugins/openin/openin-untracked-backup/`），第一阶段的旧 `src/dev-faux.ts` 存在 `/tmp/pdv2/dev-faux.old.ts`。容器里多了今天的 briefing、`info-sources.json`（一个关着的 feed 源）、`info-meals.json` 和 settings 里的 Haiku 设置。

## 重开双看门狗与 turn-log 回合号（分支 `dev/pi-durable-2k`，从 `origin/dev/pi-durable-2` 6357b583 起）

2026-10-11，两处上一节留的疑问，都先写测试，都是真的，都修了。

- 关对话再开接上：老 session（detach）和新 session 各挂一个停摆看门狗。停摆时重问只一次、没有失败行，但撤回的插话两边都写进文件（`tests/soul/door-reopen.test.ts` 红）。改成新 session 的 `resume()` 叫被 detach 的老 session 放手：`DrivenBookTurn.unwatch()` 撤它的看门狗，结算时它什么都不写；没人再打开时老 session 照旧看门、写文件。按停止本来就只有调 `stop()` 的那个拿到撤回的插话，同一测试文件里有一条，修前修后都绿。坑 540。
- 杀进程恢复后 `end aborted` 行另起回合号（`door-kill.test.ts` 让子进程把 turn-log 写进文件后比对，红）。回合号改由 `startTurn` 生成，存进 `rp.desk.turn` 和 `rp.turn` 输入的 `turn`，`begin`、请求钩子、`onSettled` 都用它。升级前起的回合没有这个字段，仍现生成。坑 541。

全量 `scripts/t.sh` 7469 过、1 跳过、0 失败，`bun run typecheck` 过。没上模拟器。


## 第二阶段 iPad 模拟器验收（分支 `verify/pi-durable-2-sim2`，从 `origin/dev/pi-durable-2` 6357b583 起）

2026-10-11，iPad Pro 11-inch (M5) 模拟器（C1F7689F），平板外壳，idb 真触摸，`.dev` 包，慢速 faux（12 token/s、每段 20 句）。没改产品代码。驱动在 Mac `/tmp/pdv3/`（`pdv.sh`、`p3.sh`、`talk3.py`、`book3.py`、`voice.js`、`voiceflow.sh`、`startdev.sh`），源、截图和报告页在会话 scratchpad `verify-phase2-sim2/`。真 Haiku 1 个回合（2 次请求）。

- 排练教练：回答一遍落盘一次；停止留半句（428 字，aborted）；正文中 SIGKILL，重启后 faux 0 次，半句一次进文件，不重问。
- 复述：开场回合自动起，停止留半句（kickoff 不进文件）；正文中杀进程半句一次、不重问；离开后回合在看不见处跑，回来 Stop 在、正文在长，落盘一次，之后才是蒸馏。
- 书（平板课堂「Learn this book with AI」）：插话后约 0.2 s 停止（发送用 idb，停止用页面 JS 点按钮），前一回合 aborted、半句留下，被撤回的插话开下一回合答完；隔 1.5 s 用 idb 点停止结果相同。idb 在发送后 0.1–0.3 s 点停止会落空（坑 539）。工具里杀进程：`read_pages` 重跑、接着写完、回合 done；恢复回合第 2 轮首字节 12.8 s，正好落在重新打开书之后，没查是不是在等书载入。
- info 语音：模拟器起不了音频栈，代码里没有不经麦克风注入转写的入口（`__orbStub` 只驱动球的样子）。用页面脚本 `voice.js` 照 `voice-call-live.ts` 装 `infoVoiceThread` 的两个口直接驱动：问答一轮落盘、不放卡；打断后落「听到的部分」带标记，下一句正常答；通话中打开文本对话接上在流的语音回合，打字成插话（同回合第 2 轮）、插话的回答也进语音流；通话中关文本对话，语音回合跑完、落盘一次、不放卡。通话状态机、识别、合成没走。
- 真模型 claude-haiku-5-5：教练一回合先调大纲工具再答，11.5 s done。
- 观察：iPad 教练页 Lumen 在右下角盖住发送键，没隐藏时两次 idb 点发送没发出去，点「Hide Lumen」后正常，原因没查；恢复后 turn-log 的 end 行 turn id 与 start 不同（同上一棒，2k 在改）；课堂逐章预备吃光 faux 的 40 步（坑 538）。
- 语音要真机做的：① 主页点 Lumen 开通话，开场白念完后说「今天有什么值得看的」，听回答念完，再看 info 对话里这句和回答各一次、Lumen 盒子没有新卡；② 回答念到一半时插话说「停一下，换个话题」，念到的那句截断，打开对话看回答末尾有 interrupted 标记，下一句正常答；③ 回答在念时点主页「Tell the companion」打开文本对话，看这条回答在对话里接着流、Stop 在，打一句字发出，听这句的回答也被念出；④ 文本对话开着时说一句，回答在念时点 Hang up 关掉对话，语音继续念完，再开对话这条只有一次；⑤ 回答念到一半时上划杀 app，重开后对话里半句一次、不出声、盒子一张卡；⑥ 问需要查资料的问题，工具调用时 Lumen 低头；⑦ 挂断后过一会看记忆里有这通电话的蒸馏。
- 环境：dev server PID 29859（`/tmp/pdv3/pids.txt`）留着在跑，旧的 12428 一组已杀；`~/rp-flow` detached 在 6357b583，工作区干净；iPad `.dev` 容器里的凭据已删、`__fauxPlan` 等已清；容器里有 Verify talk 主题（复述、大纲）、Pride and Prejudice（EPUB 从 iPhone 容器拷来）、`info-sources.json` 和今天的 briefing。

## 关对话不停回合（统一）（分支 `dev/pi-durable-2-close`，从 `origin/dev/pi-durable-2` 0fb61d95 起）

2026-10-11 用户定：所有对话面只有停止键停回合，关掉（点叉、离开页面、返回）一律不停，回合在后台跑完落盘，没人开着就放盒子卡片，再开接上。

扫了一遍哪里关掉会停：

- 已经是这样、没动：门口、info、三餐（上一节）；书的线程（`reading/session/use-call.ts`，iPad、桌面、手机 EPUB 课堂、划线提问）从 docs/03 起就只有停止和删线程才停，卸载不停，`setBookWatching` 按屏幕上开着的 call 判断，落盘没人看就放书的卡片。
- 排练教练、复述（`ui/components/chat/use-place-chat.ts`）：cleanup 原来 `leave()`（停），复述只有开过口才 `keepOnLeave`。改成一律 `detach()`；`keepOnLeave` 改名 `onLeave`，只表示要不要听「落盘了」（复述延后的蒸馏用，靠 `session.idle()`）。开着时 `registerOpenSession` 加 `watchOneThread`。`reading/turn/one-thread-place.ts` 的 lander 原来 `watching: () => true`、不放卡；现在按 `watchOneThread` 判断，没人开着就调 place 的 `card`。教练、复述的卡片在 `coach-durable.ts` / `retell-durable.ts` 的 `putCoachCard` / `putRetellCard`（`putOneThreadCard`，boxId `<id>:<ts>`）。
- 手机 PDF 课堂（`ui/components/phone/lesson/use-lesson-call.ts`）：卸载原来 `abort()`（停）。改成 `detach()`：在途回合打 `gone`，不画、不停，装配中的照样起跑，结算时只把没被收下的话写文件，不开下一回合、停摆不重问（同门口）。`setBookWatching` 原来按回合挂（关掉时停下的半句不放卡），改成按屏幕挂：课堂开着就算看着。再开课堂时 `resumedBookTurn` 接上同进程的在途回合，并叫老 hook 放手（`unwatch` 看门狗、结算什么都不写），坑 540 同款。放手的登记抽成 `reading/turn/detached-turns.ts`，`place-session.ts` 也改用它。
- 盒子卡片：`BoxOrigin` 加 `talk`、`retell` 两种（不存主题 id，跟随时 `App.tsx` 读大纲或复述的 `topicId`，`LibraryScreen` 收 `open` 请求打开教练或复述）；`box-jump.ts` 加 `open-coach`、`open-retell`、手机的 `open-book-conversation`。手机原来书的卡片一律「请在 iPad 或桌面打开」，现在开那本书的对话：PDF 进课堂（`shelf-list.ts` 的 `conversationDoor`），EPUB 开阅读器并在书载入后 `reopenThread` 那条线程（`PhoneReader` / `use-book-lesson.ts` 的 `openThreadId`）。教练、复述的卡片在手机上说「这一条请在 iPad 或桌面端打开」（`shell.box.notOnPhone`，9 种语言），旧的 `box.notReadable` 删了。

保留的例外（同日后来改掉，见下一节）：手机课堂里点「问这一段」进 aside 时仍先停课堂的回合（`PhoneLessonScreen.tsx` 的 `enter`）。这不是关对话，是在课堂里开另一条对话；不停的话回来时 aside 的回执行会写在还没落盘的回答前面（文件顺序乱）。要统一得先把回执改成按时间插，没做，等主会话定。课堂开着、在 aside 里时课堂线程仍算「看着」，落盘不放卡，回来 `reload()` 读文件看到。

测试：`one-thread-place.test.ts` 教练、复述各加两条（faux：关掉后回合不停、落盘一次、放一张卡、老视图不再画；关掉再开接上、落盘一次、不放卡）；`use-lesson-call.test.tsx` 原「离开停回合」换成三条（关掉不停、落盘后写没收下的话、不开新回合、不再算看着；装配中关掉照样起跑；再开接上、老 hook `unwatch` 一次、老回合停摆什么都不写）；`box-jump`、`box-cards`、`phone-shelf-list` 各加一条；`tests/palace/derived.test.ts` 登记 `LibraryScreen.tsx`（内存里带主题 id）。全量 `scripts/t.sh` 7478 过、1 跳过、0 失败，`bun run typecheck` 过。坑 542、543 没用。

没做：

- Linux xvfb 真 app 验收（教练、手机课堂窄屏：答到一半关掉看卡片、点卡片看到全文一次；答到一半再开接上；停止留半句）没跑，工具调用预算用完。下一棒照第二棒 B 的做法（Xvfb、`verifylinux` identifier 的 debug 二进制、本 worktree 的 vite、`VITE_VERIFY_FAUX=1`，换代码后重起 vite，坑 403）。
- hook 层：`use-place-chat` 没有 hook 测试（同上一节），关掉不停只在 place 层测了；`LibraryScreen` 的 `open` 请求和两个外壳的跟随卡片是 tsx，只过了类型检查。
- 关掉后、回合还在装配时重开（`drivePlaceTurn` / `driveBookTurn` 还没交回句柄），新视图查不到在途回合，要等落盘后靠追加通知或重开才看到（同上一节，没测）。

## 关对话不停回合：aside 与装配中重开（分支 `dev/pi-durable-2-close`，从 b390f36e 起）

2026-10-11，补上一节留的两处。

- 手机课堂进 aside 不再停课堂的回合（`PhoneLessonScreen.tsx` 的 `enter` 去掉 `stop()`）。回合在 aside 底下照常跑、照常画进课堂的行。顺序照教练卡片的做法：回执行回来时就写进文件（追加在末尾），回合落盘的行追加在它后面，所以文件里是「问题、回执、回答」；屏幕上 `use-lesson-call.ts` 的 `draw` 改用 `withPlaceTurnRows` 带 `isCardRow`，卡片行留在回合的行上面；`reload()` 碰到还在跑的回合，把文件读回来再接上回合最后画的行和没收下的话，不清掉正在流的回答。回来只看到一次，落盘后再 `reload` 和屏幕一致。看着：在 aside 里课堂不算看着（`LessonBook.covered`，屏幕传 `() => aside 开着`），落盘放卡片，同桌面 aside 打开时父对话不算看着。
- 装配中重开：`detached-turns.ts` 加 `holdStarting(key)` / `turnsStarting(key)`。每个回合从开始装配到运行时接手（`drivePlaceTurn` / `driveBookTurn` 交回句柄）登记在这里，装配失败、停止、拒绝也放开。查在途回合的唯一入口 `durable-turn.ts` 的 `resumedPlaceTurn` 先等调用那一刻登记着的回合，再 `turnInFlight`，所以门口、info、三餐、教练、复述（`place-session.ts` 的 `start` 和铃/语音的 `guest`）和手机课堂（`use-lesson-call.ts`）重开都在起跑后接上。只等调用那一刻已登记的，新屏幕自己后来起的回合不会让它等自己。书的线程（`use-call.ts`）不受影响：在途回合登记在模块级的 `readingTurns()`，装配时就在，重开的 `joinInFlight` 看到它就不去查运行时，没改。

测试：`tests/soul/door-reopen.test.ts` 加两条（faux：装配中关掉再开，新 session 的 `resume()` 等到起跑、接上、落盘一次、老 session 不画不写；装配中再开、原 session 停止，`resume()` 返回 false，不调模型），第一条去掉等待就红。`use-lesson-call.test.tsx` 加三条（回合在跑时文件多了回执，`reload` 后回执在流的回答上面、回合不停，落盘后屏幕和读回的文件一致；`covered` 为真时不算看着；装配中关掉，`turnsStarting` 等到 `driveBookTurn` 交回，停止也放开）。全量 `scripts/t.sh` 7483 过、1 跳过、0 失败，`bun run typecheck` 过。坑 542、543 没用。

没做：

- 真 app 验收没跑（本棒不开 app）：手机课堂答到一半点「问这一段」、在 aside 里问一句再回来，看回答接着流、回执在它上面、落盘后只有一次、盒子有一张卡；门口或三餐发问后立刻关掉再开，看到在流的回答。
- `PhoneLessonScreen` 的 `enter` / `covered` 接线是 tsx，只过了类型检查。
- 回执行的 ts 比它下面落盘的回答大，文件按追加顺序不按 ts。教练卡片原来就是这样；按 ts 找位置的代码（`withTurnRows` 一类）只用在回合还在跑的那段屏幕上，没发现别处受影响。

## 关对话不停回合：Linux 验收（分支 `verify/pi-durable-2-close-linux`，从 `dev/pi-durable-2-close` 64ce077a 起）

2026-10-11，xvfb `:93`，`verifylinux` debug 二进制，本 worktree 的 vite 带 `VITE_VERIFY_FAUX=1`（20 token/s、每段 30 句 2700 字），没调真模型，没改代码。驱动和截图在会话 scratchpad `verify-close-linux/`（`tools/close.py`、`asm.py`、`doorbg.py`），报告页 `verify-close-linux/report.html`。

- 教练、复述：答到一半关掉，回合跑完落盘一次、一张卡（origin `talk` / `retell`），点卡进教练或复述页、回答只一次；关掉再开，Stop 在、正文接着长、落盘一次、不放卡；停止留半句（476 / 484 字）、不放卡。
- 手机 PDF 课堂（xdotool 把窗口改成 390x844，`?shell=phone`）：开场回合答到一半点返回，落盘一次、一张卡（paper.pdf），点卡进课堂、回答一次。
- 装配中重开：页面脚本把 `appData` 的读文件包一层，发送后 1.5 s 内开始的读延迟 3 s，发送到第一次模型调用从 265 ms 拉到 3244 ms。门口、三餐发送后 150 ms 关、2 s 内重开（模型调用仍 0 次），重开的视图出 Stop、接着流、落盘一次、不放卡。
- 门口答到一半关掉（回归）三次，每次落盘一次、一张卡。手机上点教练卡片显示「This one opens on the iPad or the desk.」。
- 没走（工具调用预算用完）：手机课堂答到一半再开、停止，以及「问这一段」进 aside 再回来（回执在回答上面、只一次、在 aside 里落盘放卡、重开顺序不变）；iPad 宽度的书线程关掉；手机上点复述卡片。下一棒照本节做法，课堂书已铺好：测试数据目录 `library/b39e958bfae6fe29ccf67974459bb93e.pdf` 挂在 Verify talk 主题下。
- 环境坑（非产品）：worktree 的 vite 起来后再放进 `public/` 的文件取回的是 index.html（坑 403 同因），铺书要直接拷进数据目录的 `library/`。Tauri 窗口没有 `set_size` 权限，改尺寸用 xdotool。坑 542、543 没用。

第二棒（2026-10-12，同分支，驱动 `scratchpad/vcl3/tools/phone.py`，截图和报告页仍在 `verify-close-linux/`，报告页加了「Round 3」一节）：

- 手机课堂答到一半再开：Stop 在、正文接着长、落盘一次（2700 字）、不放卡、模型调用一次。停止：半句 556 字留在文件，不放卡。
- 「问这一段」答到一半点不出来，是真 bug，修在 b4419e0e：`PhoneLesson.tsx` 在 `messages` 每次变化时清掉长按选中的段落，回答在流时每个 token 都是新数组，菜单出来约 150 ms 就关。改成只在那段所在的回答不在课堂里时才清（`lesson-aside.ts` 的 `heldSpanStands`，单测在 `lesson-aside.test.ts`）。全量 `scripts/t.sh` 7485 过、0 失败，`bun run typecheck` 过。
- 修后 aside：在 aside 里待到课堂回答落盘，落盘一次、放一张书的卡片（盒子 5→6），回来时回执写在回答后面（按时间）。回答还在流时回来，回执在流的回答上面，屏幕和文件一致（回执 ts 1791734713772 在回答 ts 1791734696699 上面），回答一次、不放卡。aside 自己的回合在回来时还没答完，在后台跑完落进 aside 线程，放一张指向 aside 线程的书卡（盒子 6→7），符合关掉不停的规矩。再开课堂，屏幕顺序和文件顺序都不变，没有按 ts 重排。
- 合成长按要点在视口内一段已落盘回答的 `[data-reply-ts] p` 上，流着的回答没有 `data-reply-ts`，按它什么都不出（设计如此）。
- 没走（工具调用预算用完）：iPad 宽度的书线程关掉（落盘一次、没人看时卡片怎样）；手机上点复述卡片（盒子里唯一的复述卡已是 told，要先在桌面宽度用 `close.py retell <id> bg` 造一张新的；这一棒切回 1280 宽后 `close.py` 没打开复述页，没查）。坑 542、543 没用。
- 环境：本棒起的 Xvfb `:93`、vite、app 的 PID 记在 `scratchpad/vcl3/pids/history`，收尾已杀。

第三棒（2026-10-12，同分支，驱动 `scratchpad/vcl4/tools/book.py`（书线程）和 `close.py`、`size.sh`（vd.py 指向本棒 worktree），报告页加了「Round 4」一节）。没改代码。

- 桌面 1280 宽书线程（paper.pdf 的课堂线程，「Learn this book with AI」打开）：答到一半点 Hang up 留在阅读器里，回合跑完落盘一次（2700 字），放一张书卡（origin `book`、线程 id，盒子 7→8）；点卡打开那条线程，回答只一次，盒子回到 7。答到一半点「Back to library」（阅读器卸载）结果相同；在主题页点卡，进阅读器开那条线程，问题和回答各一次。书线程和教练、门口、课堂一样放卡，不是 bug。落盘后多出的一次模型调用是课堂预备（坑 538）。
- 手机点复述卡：先在 1280 宽用 `close.py retell 1791700498974 bg` 造一张新卡（落盘一次、一张卡 origin `retell`），再改成 390x844 加 `?shell=phone`，点卡显示「This one opens on the iPad or the desk.」，卡仍在盒子里（`in-box`）。
- 第二棒「切回 1280 宽后 `close.py` 没打开复述页」是驱动的毛病：reload 后驱动从 Topics 进，找文字以「Verify talk」开头的元素，主题行的文字前面带头像字母（「PVerify talk1 file」），匹配不到就抛错。直接点那一行能正常进主题和复述。
- 本轮的复述那一跑覆盖了第一棒的 `retell-bg-1-streaming.png`、`retell-bg-2-landed-home.png`（同一场景）。坑 542、543 没用。
- 环境：Xvfb `:93`、vite、app 的 PID 记在 `scratchpad/vcl4/pids/history`，收尾已杀。本棒 worktree 跑过 `bun run wasm`（`public/pdfium/` 未跟踪，没提交）。

## 关对话不停回合：模拟器验收（分支 `verify/pi-durable-2-close-sim`，从 `dev/pi-durable-2-close` 64ce077a 起）

2026-10-12，iPad Pro 11-inch (M5)（C1F7689F）和 iPhone 17 Pro（18CF1932）模拟器，`.dev` 包，idb 真触摸，Mac `~/rp-flow` detached 在 64ce077a，只起 vite（`VITE_VERIFY_FAUX=1`，20 token/s、每段 30 句 2700 字），原生部分自 f425983f 没变所以没重装 app。容器里放占位凭据（跑完已删）。没调真模型，没改代码。驱动 Mac `/tmp/pdv4/d.py`，截图、日志和报告页在会话 scratchpad `verify-close-sim/`。11 项全过。

- iPad 教练、复述：答到一半点叉再点 Today，落盘一次、一张卡（origin `talk` / `retell`），点卡进教练或复述页、回答一次；关掉再开，Stop 在、正文接着长、落盘一次、不放卡；停止留半句（588 / 596 字）、不放卡。复述落盘后多一次模型调用是延后的蒸馏。
- iPad 书（平板课堂）：答到一半点 Hang up，落盘一次，对话关着所以放一张书的卡；再开课堂回答一次。
- iPhone 门口：答到一半关掉，落盘一次、一张卡。装配中重开：页面脚本让发送后 2.5 s 内开始的 `appData` 读延迟 6 s，回车发送、0.52 s 后点 Close（模型调用 0 次），长按卢明点 Text 在 4.6 s 重开（仍 0 次），重开的视图出 Stop、接着流、落盘一次、不放卡。前一次重开没点中菜单，回合落盘一次、放一张卡。
- iPhone 教练卡片（页面脚本 `putOneThreadCard` 铺的，手机上没有教练）：点了显示「This one opens on the iPad or the desk.」。
- iPhone PDF 课堂（attention.pdf）：答到一半点返回，落盘一次、一张书的卡；点卡进课堂、回答一次，盒子少一张。
- 观察：iPad 教练页卢明盖住发送键，idb 点 Send 发不出去（上一棒也见过），回车能发。盒子列表可滚动，卡片多时下面的卡在屏幕外，idb 要点列表顶上那张。
- 没走：手机课堂答到一半再开、停止、「问这一段」进 aside；手机上点复述卡片。坑 544、545 没用。
- 环境：vite PID 93151（子进程 93153，`/tmp/pdv4/vitepid`）留着在跑；旧 dev server 29859 一组已停；ios_webkit_debug_proxy 78195 没动；iPhone 的 `__fauxPlan` 已清，iPad 的还在（app 没开着）。

第二棒（2026-10-12，分支 `verify/pi-durable-2-close-sim2`，从 `dev/pi-durable-2` 8d6a7d8b 起，含 aside 修复和 b4419e0e）：Mac `~/rp-flow` 切到 8d6a7d8b、重起 vite（坑 403），只用 iPhone 17 Pro，同样的 faux 和占位凭据（跑完已删、`__fauxPlan` 已清）。驱动 Mac `/tmp/pdv5/d.py`（`round2 reopen-stop|aside-live|aside-stay`），副本、截图、日志在会话 scratchpad `verify-close-sim2/`，报告页 `verify-close-sim/report.html` 加了「Round 2」一节。6 项全过，没改代码。

- 手机课堂答到一半返回再开：Stop 在、正文接着长（4 s 13808→14143 字）、落盘一次、屏幕上一次（两个问题之间 30 句）、不放卡、模型调用一次。停止：半句 600 字留在文件，15 s 后不变，不放卡，没有多的调用。
- 「问这一段」：回答在流时真长按一段已落盘的回答，菜单 0.6 s、3.1 s 都还开着（b4419e0e 修好了）。在 aside 里问一句、4 s 后回来：Stop 在、回答接着流，回执在流的回答上面（屏幕和文件都是问题、回执、回答），回答一次，课堂不放卡；aside 自己的回答在后台跑完，放一张指向 aside 线程的书卡（同 Linux）。在 aside 里待到课堂落盘：放一张课堂线程的书卡，aside 的回答在开着时落盘不放卡，回来回执在回答后面。两种情况再开课堂顺序都不变。
- 手机点复述卡（页面脚本 `putOneThreadCard` 铺的，origin `retell`）：显示「This one opens on the iPad or the desk.」，卡留在盒子里。
- 观察：从 aside 回来不滚动（不自动跟随），回执要按 DOM 顺序查或滚过去看。在 aside 里放的课堂卡片，回来读过回答后仍留在盒子里，只有点卡才收走。驱动找段落时要按「和视口相交」取：faux 的回答是一个 1560 px 高的 `<p>`，整段落在视口内的条件永远不成立。坑 544、545 没用。
- 环境：vite PID 6861（子进程 6863，`/tmp/pdv4/vitepid`，`/tmp/pdv4/pids-history`）在 `~/rp-flow` 8d6a7d8b 上留着跑；旧的 93151/93153 已停。iPhone 盒子里多了 seed 复述卡和本轮的几张书卡。

## 第二阶段 iPad 真机验收（第二轮）（分支 `verify/pi-durable-2-ipad2`，从 `dev/pi-durable-2` 7195343e 起）

2026-10-12，iPad（iPad15,7，iOS 26.7.1）插 Mac mini，pymobiledevice3 装包、`dvt launch/kill/screenshot --userspace`，ios_webkit_debug_proxy 进 WKWebView。Mac `~/rp-ipad` 切到 7195343e，`~/build.sh`（`VITE_VERIFY_FAUX=1`）出 `/tmp/rp-dev-ipad2.ipa`，装前读回 CFBundleIdentifier 为 `.dev`。慢速 faux 20 token/s、每段 30 句 2700 字。真机没有程序化触摸，全部输入走页面 JS（点按钮、设 textarea、Lumen 用 `contextmenu` 事件开菜单），读文件直接调 `plugin:fs` 和 `write_text_file_atomic`（ipa 是生产构建，没有 `/src` 模块和 `__bell`）。驱动 Mac `~/v2.py`（页面助手 `~/v2h.js`，`~/rp_lib.py` 是去掉 `main()` 的 `rp.py`），日志和截图在 Mac `/tmp/v2/`，副本和报告页在会话 scratchpad `verify-ipad2/report.html`。没改代码，坑 546、547 没用。

- 升级收尾：过。旧包（第一阶段）的 `session/--session-soul--` 里 5 个只有表头的 session。新包没凭据第一次启动不动；放占位凭据后第一次启动把组删空（目录留着），没有 soul 回合。启动时跑了一次 `subagent` 回合，拿占位凭据打到 Anthropic 得 401。
- 门口：关掉落盘一次、一张卡（origin door），点卡开门口对话、回答一次；关掉 3 s 后重开，Stop 在、正文接着长、落盘一次、不放卡；停止留半句 732 字、12 s 后不变；切后台 30 s、60 s（`dvt launch` 设置），离开时 JS 冻结，回前台 1.5 s 内接着流，回合 done，没有停摆和重问；正文中 SIGKILL，重启 faux 0 次，半句 780 字一次、一张卡，`end aborted` 与 `start` 同一个回合号（2k 修复在真机上成立）。
- info、三餐：关掉、重开同门口都过，info 杀进程同门口。info 卡（origin briefing）点了进简报页，三餐卡进三餐页，都不打开对话，要再点「Tell the companion」/「Ask about this week」才看到回答（box-jump 的设计，记一笔）。
- 教练、复述：关掉一张卡（talk / retell）、点卡进页面回答一次；重开接着流；教练停止留 740 字、杀进程半句 768 字一次加一张卡。真 iPad 上卢明盖住教练和复述页的 Send 键（Send 中心点的 `elementFromPoint` 是卢明的按钮）。
- 书（iPad 课堂）：Hang up 关掉落盘一次、一张书卡带线程 id，点卡开回线程、回答一次；插话后 200 ms 停止，前一回合 aborted 留 596 字，插话开下一回合答完；`read_pages` 拉到 15 s 时 SIGKILL，重启同一回合号重跑工具、接着跑完 done。恢复后第 4 轮首字节在第 3 轮工具之后 13.3 s，早于重开书，和 iPad 模拟器的 12.8 s 同样，没查。
- 铃：读者 info 回合在流时往 `legion/bell/` 写一只 run-done 铃（deliverTo 简报），读者回合落盘后 93 ms 铃回合才起，落在读者回答之后，铃 acked，对话开着不放卡；重启后 turn-log 无新行、faux 0 次、不重投。
- 真模型：没跑。Linux 上的 access token 跑之前已过期 13.9 小时，Haiku 0 次。
- 库：本轮 31 个回合（门口 6、info 6、教练/复述 6、书 5、铃 1、subagent 7）后主库 1,359,872 字节、WAL 4.2 MB 未 checkpoint；第一阶段结束时主库 316 KB，约 33 KB/回合。拷出来 checkpoint 后 1.38 MB，`entries` 占 1.0 MB。
- 没走：真模型一回合（要新的 access token）、语音（和用户一起）、复述停止和杀进程、三餐停止和杀进程。
- 收尾：容器里占位凭据已删，`__faux*` 键已清，app 重起（PID 7599）不带 faux；没拷过真凭据。Mac 上 ios_webkit_debug_proxy 78195、vite 6861/6863 没动。容器里多了 Verify talk 主题（大纲、复述从 iPad 模拟器拷来）、`info-sources.json`、`info-meals.json`、今天的 briefing、`settings.meals`。
- 接着做：access token 有效（离过期超过 30 分钟）时只拷 `access`、`expires` 进 `.dev` 容器，`refresh` 填假值；`~/v2.py flow door bg60` 跑一个 Haiku 回合（注意回前台可能多一次 `subagent` 请求），完了删凭据。`~/d.sh pull durable` 拉完 afc 不退出，文件到了就杀自己记下的那个 afc PID。
