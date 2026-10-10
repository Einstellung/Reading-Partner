# pi-durable spike

2026-10-10。评估用 `@earendil-works/pi-durable` 1.1.0 替换回合运行时（`legion/execute` 4046 行、`soul` 的 harness 部分（核心 3091 行，`voice/` 不算）、`reading/turn` 的流式），对话文件、同步、后台任务、budget 不在范围内。分支 `spike/pi-durable`，没合 main。

代码在 `src/legion/durable/`：`durable-fs.ts`（AppData 上的 JSONL FileSystem 门面）、`write-meter.ts`（写放大计数）、`spike.ts`（faux 模型 + `lookup` 可重放读工具 + `note` 不可重放工具）、`probe.ts`（不需要杀进程的三个场景，给浏览器引擎跑）。测试在 `tests/legion/durable/`：`scenarios.test.ts`（同进程）、`crash.test.ts` + `crash-child.ts`（真 SIGKILL 子进程再重开）、`probe.test.ts`。一手资料是 npm 包里的 README 和 CHANGELOG（examples 不在包里）。

## 1. 依赖与打包

- pi-durable 1.1.0 和 chord 1.1.0 都是 MIT，可用。pi-durable 依赖 `pi-ai ^1.1.0`、`chord ^1.1.0`、`diff 8.0.4`、`typebox 1.3.27`，不依赖 pi-agent-core。chord 声明了运行期依赖 `esbuild`，只有 `chord/bundler` 子路径用到，pi-durable 不 import 它，前端包里没有。
- 和 pi-agent-core 0.87.1 + overrides 里的 pi-ai 1.1.0 能装在一起：`bun add` 后只有一份 pi-ai，typecheck 和全量测试都过（commit 5881e266）。
- 最终形态是 pi-agent-core 1.1.0 + pi-durable、去掉 overrides：breakage inventory 见第 7 节。pi-agent-core 1.1.0 只剩 `Agent`（有状态的内存 agent loop，自带 steer/followUp 队列和事件）、`agentLoop`、proxy、`setDefaultStreamFn`，没有持久化。pi-durable 不用它，自己直接建在 pi-ai 上。迁到 pi-durable 后我们用不到 pi-agent-core 的任何东西（现在只有一处 import 了它的 `AgentMessage` 类型），依赖可以删掉。
- vite 5.4 打包没有 Node 内置模块被外置的警告。probe 页按 npm 包分块（minified / gzip）：pi-durable 135.0 / 39.9 KB，chord 44.6 / 13.7 KB，typebox 125.7 / 34.1 KB，pi-ai（核心 + faux）37.1 / 11.6 KB，`diff` 被 tree-shake 掉。app 已经带着 pi-ai 和 typebox（pi-agent-core 0.87 用它校验工具参数），净增量是 pi-durable + chord，约 180 KB minified、54 KB gzip。

## 2. 真实运行环境

`probe.ts` 的三个场景（AppData 内存盘上的 JSONL 往返、postTools 边界的 steer、同一 harness 里两个对话并行流式）打成一页：

- WebKitGTK 2.52.6（本机 Tauri 用的同一份系统库），`xvfb-run` 下的 offscreen 窗口：全过，331 ms，`isSecureContext` 为 true。
- iOS 26.5 模拟器（Mac mini，已启动的 iPhone 17 Pro）里的 Mobile Safari，和 WKWebView 同一个 JavaScriptCore：全过，370 ms。

没验的：Tauri fs 插件那条 IPC 路径（probe 用内存盘，没在 app 里经 `appData` 真写盘），以及 app 的 `tauri://` 源。引擎层面没有障碍。

## 3. 存储门面

`/storage/jsonl` 的 `JsonlStorage.open(dir, fs)` 要一个 26 个成员的 `FileSystem`，它自己只调 11 个：`absolutePath`、`joinPath`、`createDir`、`appendFile`、`flushFile`、`remove`、`writeFile`、`renameFile`、`listDir`、`truncateFile`、`readBinaryFile`。`durable-fs.ts` 在 `AppDataFs` 上实现这 11 个，160 行（含注释），比现有 `session-fs.ts` 的 357 行短，因为不做路径围栏也不写其余 15 个的 not_supported。AppData 没有 truncate，用读出来切片再写回代替，只在恢复截断坏尾行时走。

写放大（faux 70 token/s，1440 个汉字 = 4320 字节的回答，`crash-child.ts measure`）：

| partialIntervalMs | append 次数 | 追加字节 | 重写 | 结束后目录 |
|---|---|---|---|---|
| 100 | 110 | 27.4 KB | 3 次 0.6 KB | main.jsonl 11.7 KB + 5 个 sidecar 0.96 KB |
| 500 | 36 | 16.7 KB | 3 次 0.6 KB | main.jsonl 8.2 KB + 0.96 KB |

部分提交写的是 chord 增量，不是整段重写。`pi.live` 的增量进 `doc-2.jsonl`，回答结束后 reclaim 缩回 136 字节；每次提交在 `main.jsonl` 留一行约 48 字节的标记，永远留着。一问一答落盘约为回答的 2.9 倍，`main.jsonl` 只追加、没有压缩，打开时整份回放进内存（坑 512）。目录形态：一个 storage 一个目录，`main.jsonl` + `doc-<id>.jsonl` + 在途任务的 `task-<id>.jsonl`（结束后删）。

## 4. 核心语义

全部有自动化测试，faux provider，杀进程用真 SIGKILL：

- (a) 流式回答写到 200 多字时杀掉，重开后 `pi.live` 里是杀前最后一次提交的半句（最多丢 100ms）；`resume()` 后 run 跑完、submission `done`。但重问是全新请求，半句不带上去，最后 transcript 里只有重问的回答，半句挂在 `pi.live` 里直到被换掉（坑 511）。
- (b) 不可重放的 `note` 执行中被杀，重开后不再调用它，模型收到 `isError` 的工具结果 `<harness>\n[error] Tool note was interrupted and may have partially run\n</harness>`，据此回答，run `done`。可重放的 `lookup` 同样场景会重跑一次再交给模型。
- (c) 工具执行中 `submit({ whenBusy: "steer" })`，下一次请求的消息序列是 `system, user, assistant, toolResult, user(steer)`，transcript 顺序同此，两个 submission 都 `done`。
- (d) 同一 harness 两个 ownerless 对话同时提交，两边的 `pi.live` 有同时在流的时刻，各自回答正确。并行是 harness 内建的，不需要 lane。

## 5. 概念映射

| 我们的 | pi-durable | 去留 |
|---|---|---|
| lane（`execute/held.ts`：每个对话一条 lane、一份 held harness，同对话回合在 promise 链上排队，每次 acquire 换工具、模型、prompt） | conversation 自带的 busy 状态 + `pi.inbox`；同一 harness 多对话并行；每对话 agent 用 `configure()` | 删 |
| `OpenOperation`、坑 308 的「上个进程留下的 open operation 先 resume 或 abort」 | 任务 checkpoint + `harness.resume()`；不可重放工具自动写 interrupted 结果 | 删 |
| `settlePrevious`（`execute/harness.ts`：没配恢复时进程起来 abort 所有 open operation、轮换 session、留最新 5 份） | `harness.resume()` 接着跑；不要的用 `conversation.abort()`；storage 不轮换 | 删 |
| recover 的读回（坑 391、395、509：从 transcript 拼出被杀回合已说的话） | 已提交的 entry 就是事实；在途半句在 `pi.live`，重问会重新生成（坑 511） | 删读回；要保留半句得另写一条 entry |
| `DELIVERY_ENTRY` / `PROMPT_ENTRY`（session 里的自定义印记，用来认回合边界和找回收件方） | submission 本身（`requestId` 幂等、`harness.submission(id)` 重新拿到）；回合边界是 `pi.user` 条目；自定义信息可用自己的 entry kind 或文档 | 删 |
| `steering.ts` 的差集（算哪些 steer 还没进 transcript） | `pi.inbox` 是持久文档，steer 在 postTools 和 final 边界取，`submission.wait()` 报结果 | 删 |
| 90 秒停摆看门狗（坑 390、491） | `settings.stream.timeoutMs` 管单次流超时；iOS 冻结后连接不报错的问题仍在网络层 | 留，改成掐 `conversation.abort()` 或靠 stream timeout，不再需要 lane 交还 |
| bell 投递（`soul/bell.ts`：一次一个，对话空闲起 headless soul 回合，有回合在跑就当内部 steer 塞进去，落地后才 ack） | `submit({ type: "input", requestId: <bell id> })`，忙时按 follow-up 或 steer 排队，`requestId` 保证重启不重投；只写不问用 `type: "write"` | bell 文件和 ack 留，投递动作换成 submit，内部 steer 那条路删 |
| subagent（`legion/subagent`） | task 拥有的子对话（README 的 subagent 工具）：父 abort 连带子、`background: true` 跨边界 | 改写成 pi-durable 子对话，删自己的隔离 runner |
| 回合上下文从 threads 文件组装（session 从不当上下文读回，每回合从 session root 开始） | `GenerationTask` 的 `beforeRequest` hook 换掉一次请求的 messages，或每回合 `reset()` 后写入 | 留，接到 hook 上 |
| 回合组装、工具定义、prompt 拼装 | extension（tools / sections / hooks）+ `configure()` 每对话 agent | 留，改写 |

对不上的：pi-durable 一个 Harness 只开一个 Storage、没有跨进程锁；我们 session 按线程存多份文件，换过去要么一个全局 storage（坑 512 的线性增长），要么按书开多个 harness（并行只在同一 harness 内）。provider 的鉴权、模型目录、请求改写走 pi-ai 的 `Models`，现有 `ai/` 那层要接到 `createModels()` 上。

## 6. 两份数据

transcript 只管在途，落地仍写对话文件。依据：

- 现在就是这样：回合上下文从 `threads-*.json` 组装，session JSONL 只给恢复用（`soul/recover.ts` 是它唯一的读者）。换成 pi-durable 后恢复由它自己做，session 的这个唯一用途也被它接走。

- `threads-*.json` 由同步引擎按文件合并、两台设备各写各的；pi-durable 的 storage 是单进程单写者、没有合并语义，盘上格式是提交序列不是文档，不能交给现在的同步。
- 按坑 512，storage 只增不减，打开要整份回放；拿它当全部历史的唯一来源，越用越慢。
- `watch()` 掉队超过 100 帧会丢中间帧换整份视图，`watchEvents` 也一样，投影器要能幂等地重算整份，做得到但没有省下什么。

做法：回合结束（submission `done`）时把这一轮的 entry 投影成线程里的消息写进对话文件，`pi.live` 只喂界面的流式显示；对话文件里已落的部分就可以在 storage 里 `reset()` 掉或者按书开新目录，控制 storage 大小。读回、印记、差集这些「从 session 推断回合状态」的代码因此全部不需要。

## 7. 迁移估算

breakage inventory（分支上的 `Breakage inventory` 提交）：pi-agent-core 升 1.1.0、去掉 overrides、`rm -rf node_modules && bun install` 后 `tsc --noEmit` 84 个错（第二段 `tsconfig.test.json` 因第一段失败没跑）。直接 import pi-agent-core 的只有 6 个文件，其余是这几处类型丢失后的隐式 any 连锁：

| 模块 | 错 | 文件 | 丢失的符号 |
|---|---|---|---|
| legion/execute | 51 | harness.ts、held.ts、turn.ts | `AgentHarness`、`AgentHarnessTool`、`JsonlSessionRepo`、`JsonlSessionMetadata`、`Session`、`OpenOperation`、`LaneSnapshot`、`OperationResultRecord`、`CompactionSettings`、`FileSystem`、`FileError`、`Context`、`BACKGROUND_CONTEXT`、`JsonValue` |
| platform/app | 27 | session-fs.ts | `FileSystem`、`FileInfo`、`FileError`、`Result`、`ok`、`err` |
| soul | 6 | harness.ts、recover.ts | `Context`、`BACKGROUND_CONTEXT`、`Entry` |
| reading/turn、legion/subagent | 0 | — | 不直接 import，经 legion/execute 间接受影响 |

编译错误数低估了工作量：丢的是整个 harness，所有用到 lane、operation、session entry 的逻辑要按第 5 节重写，不是改签名。

| 阶段 | 内容 | 量 | 风险 |
|---|---|---|---|
| 0 | `durable-fs.ts` 收成正式的 platform/app 门面（替换 session-fs.ts）、真机上经 Tauri fs 跑一次 crash 场景 | 小 | 低 |
| 1 | 阅读回合：`reading/turn` 的流式改订阅 `viewState`，`legion/execute` 里阅读回合用到的 harness/held/turn 换成 Harness + extension；submission done 时投影落对话文件 | 大 | 中：界面的流式、steer 切行（坑 360、510）要按 inbox 语义重做 |
| 2 | soul：soul harness、recover、lane 共用删除，soul 回合改成同一 Harness 下的对话；bell 投递改 submit | 大 | 中高：soul 回合并发多、恢复路径是最多坑的地方 |
| 3 | subagent 改 task 拥有的子对话；pi-agent-core 依赖删掉 | 中 | 低 |
| 4 | 删旧代码（坑 291 306 307 308 338 360 367 368 390 391 394 395 491 507 508 509 510 对应的补丁大多随之消失），旧 session JSONL 不迁，只保证对话文件完整 | 中 | 低 |

阶段 1 和 2 不能长期并存：两套运行时会抢同一线程。建议阶段 1 先只换阅读回合，soul 继续跑 0.87.1，此时 pi-agent-core 留 0.87.1 + overrides（已验能和 pi-durable 共存），阶段 2 完成再升 1.1.0。

## 交接

没做的：在 app 里经 Tauri fs 插件真写盘跑一次 crash 场景（需要 dev 入口和起 app，本机用户的 dev app 在跑，没碰）；`tsconfig.test.json` 那段在 1.1.0 下的错误数（第一段失败后没跑，8 个测试文件 import 了 pi-agent-core）；真模型（Anthropic）下的首包延迟和 `stream.timeoutMs` 与 90 秒看门狗的分工。spike 的代码和测试在 pi-agent-core 0.87.1 的提交上全绿，分支最后的 breakage inventory 提交有意编译不过。
