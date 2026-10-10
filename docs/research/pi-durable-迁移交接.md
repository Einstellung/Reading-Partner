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
