# Pi Durable 无人值守调研

2026-10-13 对 Pi Durable 社区项目怎么做无人值守长任务的调研。起因是将来需要大量无人值守任务（定时采集、后台加工），先看社区的做法有哪些能借鉴。只读了各项目的源码，没有安装或运行。

我们的接法：每台设备一个共用 SQLite 库、一个 Harness。回合用 `rp.turn` 任务跑，历史不进库，每回合先 `reset()`，副作用工具按 replay 表分 safe 和 unsafe（[docs/soul/87](../soul/87-回合运行时迁到pi-durable.md)）。下面各项都对照这个基线。

## 推文点名的项目

| 项目 | 星 | 最近提交 | 许可证 | pi-durable 版本 |
|---|---|---|---|---|
| TannerMidd/pi-pocket | 367 | 10-12 | MIT | 1.1.0 |
| richardanaya/pi-orbs | 19 | 10-06 | MIT | ^1.0.0 |
| IgorWarzocha/pi-durable-components | 5 | 10-08 | MIT | 1.1.0 |
| Nyarlathoteppppp/pi-durabletask-mcp | 7 | 10-11 | MIT | 1.0.0 |
| melian-agent/melian | 0 | 10-12 | MIT | 1.0.0 |
| igor-makarov/shurik | 0 | 10-12 | 无许可证（只能读，不能抄） | 1.0.2 |

**Pi Pocket**：多人共用的 Pi 网页应用，手机浏览器访问，服务端跑在本机或 Termux 上，库是一个 `pocket.sqlite`。和无人值守相关的部分在 `src/server/schedules.ts`、`goals.ts`、`spend.ts`。
- **定时**：每个定时消息是一个 durable task，分 `wait` 和 `send` 两个 phase。`wait` 用 `runtime.sleep(next)`。重启时如果还在睡就接着睡；如果已经过点，就立即发一次。
- **防重发**：requestId 取 `schedule-<taskId>-<runs>`，pi-durable 按 requestId 去重，所以 send 中途被杀、重跑也不会发两次。
- **补发**：下次时间由 `nextRepeat(every, now)` 从当前时刻算起，停机期间错过的多次合并成一次。
- **门禁**：发之前查两件事，人是否还有权限、花费是否超限。不满足就取消这个定时，并在对话里写一行原因。
- **Pi 自己建定时**：`schedule` 工具带一个 `key`，工具调用重放时找回同一个定时，不会新建。
- **`/until`**：每次最终回答后跑一遍检查命令，失败就把输出尾部喂回给模型，最多 5 次。
- 和 README 一致。

**Pi Orbs**：一个 npx 客户端，把服务端部署到 Fly.io Sprite 上。
- 推文说"每个线程挂一台独立电脑"，现在的 README 和代码是所有 bot 共用一台 Sprite，每个 bot 只是一条对话。
- 定时靠外部的 cron-job.org 回调 webhook。`/hooks/<token>` 里 `submit` 不带 requestId，对话忙时直接回 409 丢掉。所以 cron 重试会重复投递，忙的时候则会漏掉，没有防重。
- check-in 的 requestId 用 `Date.now()`，同样不能去重。
- 持久化只是 `harness.resume()` 加 SQLite。

**pi-durable-components**：14 个组件（推文说 11 个），从 GitHub Release 装，没发 npm。和无人值守相关的是两个：
- **Context**：`notes` 存笔记，`history` 按窗口检索历史，`new_context` 先存检查点、再开干净窗口接着做。上下文用到 85% 和 90% 时提醒，空闲 25 分钟后下一条输入先走检查点。状态全部用 `defineDoc` 存在宿主的 Durable 库里，`context/src` 和 `agents/src` 没有任何 `node:` import。前提是用户输入必须走 `management.submit`。
- **Agents**：持久化的 worker 对话加共享讨论板。

Browser 走 CDP 复用本机 Chrome，Code/Notebook 依赖 node-pty 和 Deno，都只能在桌面上用。README 写得很老实：重启后 kernel 和 shell 会丢，被打断的工作只报告不重放。

**pi-durabletask-mcp**：让 Claude Code 或 Codex 把长任务委派给 Pi。
- 默认纯内存，`durable: true` 才写 SQLite，和推文一致。
- 它没用 Harness 的对话模型，而是把旧的 pi coding-agent `AgentSession` 包进一个自定义 durable task。每个重要事件提交一次完整 session 快照，工具开始前先提交。
- 恢复时被打断的工具一律回报"结果未知，先查外部状态再重试"（`src/pi/repair.ts`），不盲目重放。
- 每个任务一个 SQLite，外加一个 catalog。谁拥有任务靠 SQLite 的 POSIX 文件锁判断，进程死了内核自动释放锁。

**Melian**：代码审查。不重复发帖的机制是真的实现了，在 `packages/pipeline/src/publish.ts` 和 `packages/github/src/publication.ts`：
- 每条帖子都带一个隐藏的 HTML 注释标记，用 HMAC 签名。密钥是每个 changeset 首次发布时生成的 32 字节随机数，存在库里。
- 每发一帖就单独提交一次，记录"已发"。
- 发帖之前先从 PR 上读回自己签过名的标记。如果在"已发帖"和"已记录"之间被杀，重跑时能找到那帖，不会再发。
- 任务输入里记着目标（PR、base、head）。恢复后目标变了就直接作废、一帖不发；运行中每次发帖前也会再问一遍 PR 当前状态。

README 和代码不一致的地方：
- **无人值守还没做**：README 说"keeps watch"、能跑在 GitHub Actions 上、审查状态默认存在仓库里的一个分支上。实际上 Actions host 和这个状态分支都排在 milestone 3，没有实现（见 `docs/design-implementation-plan.md`）。现在只能手动跑 CLI 的 `review` 和 `publish`，库在 `.git/melian/<changeset>.sqlite`。
- **换机器会重发**：密钥只存在本地库里。design.md 自己写了，换一个密钥会让旧标记全部失效，下次崩溃就会重发。所以在每次都从零开始的 CI 里，"部署后不重复发帖"要等状态分支做出来才成立。

**Shurik**：GitHub Actions 里的 Ralph 循环。
- **每轮全新上下文**：每轮先 `abort()` 停掉旧工作、再 `reset()`，不在一轮中间恢复。
- **存储**：用的是 JSONL journal（fsync），不是 SQLite。每轮工具执行完，在提交锁里拷一份 journal 快照，由 supervisor 推到 `shurik-control/<id>` 分支。
- **翻历史**：模型靠 `list_sessions`、`search_sessions`、`read_session` 三个工具，按每轮记下的 minEntryId 到 maxEntryId 范围读以前各轮的记录。
- **时间预算**：系统提示里实时写剩余时间，最后一段时间要求模型留交接和检查点。
- **防重复认领**：用 generation 加 CAS 写 `control.json`，旧的排队 run 抢不到新 generation。
- **恢复**：每 15 分钟一次 cron 检查，被中断的就重新派发。报错不停，下一轮接着做。
- **和推文不一致**：README 写明新建的循环只跑发布版引擎、不采用仓库里的文件，"自修改"只剩旧循环在用。

## 推文没点名、和无人值守有关的

| 项目 | 星 | 许可证 | 值得看的点 |
|---|---|---|---|
| finnvoor/PiDurableKit | 242 | CC0 | pi-durable 跑在 JavaScriptCore 里，给 Swift 用的 API，支持 iOS 17+ |
| xiaomoBoy/pi-durable-assistant | 32 | MIT | 定时计划、后台子 agent、微信通道 |
| daya0576/pi-imessage | 42 | MIT | 回复最多发一次 |
| cosmyo/ha-pi-durable | 10 | MIT | 结果未知的动作不重试 |
| acoyfellow/tardigrade | 13 | MIT | 演示进程被反复杀掉后照样完成 |
| cloudflare/agents（PiHarness） | 5812 | MIT | 被驱逐后唤醒 |

- **PiDurableKit**：被杀后重新打开库就能接着跑，但没有任何 BGTask 或后台执行的处理。它在 iOS 上也只做到"回到前台后恢复"。
- **pi-durable-assistant**：
  - 定时分 sleep、fire、deliver 三段。
  - requestId 用 `schedule:<id>:<at>`。
  - 计划条目带 `revision`，取消或修改后旧任务到期时发现 revision 对不上，就不发。
  - `nextOccurrence` 合并错过的次数，同时对齐原来的节拍。
  - 子 agent 是任务拥有的子对话，结果用 `whenBusy: "followUp"` 回投父对话。
  - 睡眠用 Node 的 setTimeout 每 60 秒循环一次，没用 `runtime.sleep`。phase 会重跑，所以不出错。
  - 通知在最后一次提交之后才发，崩溃时可能丢，属于最多一次。
- **pi-imessage**（`src/agent/deliver.ts`）：
  - 发送前先在一次提交里标 `sending`，发完再标 `sent` 或 `unknown`。
  - 启动时把所有还是 `sending` 的改成 `unknown`，永不自动重发。
  - 如果期间有更新的输入，旧回答压住不发；后一条回答顶替前面压住的。
  - 每 6 小时用一个后台 durable task 压缩上下文。
- **ha-pi-durable**：
  - 先持久化意图，再做唯一一次尝试。
  - 中断后结果算未知；对同一实体的写入暂停，直到人工对账或只读确认。
  - SQLite 用 `synchronous=FULL`。
- **tardigrade**：恢复时用同一个 requestId 重新提交；`write_file` 内容相同就不产生新 commit，所以声明为 safe。另外拿 Pi 的 23 项存储一致性测试跑了自己的存储适配器。
- **cloudflare/agents**：每个有活的会话挂一个生命周期 job，运行中靠刷新 job 当心跳。对象被驱逐后 alarm 照样到期，把对象拉起来，再由 Pi 恢复。

## 对 Reading-Partner 可借鉴的

1. **info 定时采集做成 durable task**：照 Pi Pocket 和 pi-durable-assistant 的写法，`wait` 用 `runtime.sleep` 睡到点，`send` 用 `schedule:<id>:<第几次或时刻>` 当 requestId 起回合，计划条目带 revision。iOS 挂起时睡眠自然暂停，回前台后过点的只发一次。错过的次数要合并成一次，不能补齐一串。目前 `legion/schedule` 的时钟和铃可以沿用；值得借的是"requestId 由计划 id 加次数推出"和"revision 作废旧任务"这两点。
2. **外部副作用的两种收口**：
   - 对方不接受幂等键（推送通知、发消息、写别人的服务）：用 pi-imessage 的做法，提交 `sending`、执行、记录 `sent` 或 `unknown`，启动时把 `sending` 全改成 `unknown`，不自动重发，交给人或对话处理。这和我们的 unsafe 工具拿到 interrupted 结果是一个思路，可以推广到不经模型的后台副作用。
   - 能从外部读回自己写过的东西：用 Melian 的做法，先读回再写。我们落盘时"同 ts 跳过"已经是这一类。
3. **恢复后先验目标还在不在**：照 Melian 的作废机制和 Shurik 的 generation。后台任务恢复时先确认目标（主题、书、条目）还存在、版本没变，不对就直接结束，不产生副作用。info 主题被删、书被移走都适用。
4. **长时间后台 agent 每轮全新上下文，历史按范围查**：Shurik 每轮 `reset()`，每轮记下 entry id 范围，配三个只读的历史工具。我们已经每回合 reset，历史在对话文件里。将来 info 加工这类多轮长跑，可以给它一个按轮次查旧记录的 safe 工具，再在系统提示里写剩余时间和"到点前留交接"。这对 iOS 后台那几十秒的窗口尤其有用。
5. **花费和次数的硬上限**：Pi Pocket 超花费就拒绝新输入、停掉越线的 run，`/until` 最多 5 次。无人值守必须有这个；我们的 budget 和 quota 要覆盖后台回合。
6. **Context 组件的思路**（笔记加按需开新窗口）可以参考。不建议直接装：它要求所有输入走 `management.submit`，和我们 `beforeRequest` 整体换掉 messages、`compaction.enabled: false` 的做法冲突。许可证 MIT，和 PolyForm Strict 不冲突，引入要保留版权声明。
7. **SQLite 同步级别**：我们是 WAL 加 `synchronous = NORMAL`，app 被杀不丢已提交的数据；系统崩溃或断电可能丢最后几次提交，相当于"sent"标记可能回退。只有外部副作用的状态要求严格时才值得改成 FULL，目前不急。存储一致性测试我们已经有了（`tests/platform/app/durable-sqlite.test.ts`）。

## 不适用的

- **依赖云端或常驻服务器**：Pi Orbs（Fly Sprite 加 cron-job.org，而且没有防重）、cloudflare/agents 和 tardigrade（Durable Object 加 alarm）、Shurik（GitHub Actions 加 control 分支）、Melian 的 CI 形态。iOS 上没有"alarm 把进程拉起来"的等价物：BGAppRefresh 和 BGProcessing 由系统决定何时给、给多久，WKWebView 在后台也会被挂起。所以 iOS 端的"无人值守"上限是"回前台补跑"。真要定时准点跑，执行端只能放在常驻的桌面上。
- **只能桌面**：components 的 Browser（CDP）、Code/Notebook（node-pty、Deno），Pi Pocket 的浏览器工具，durabletask-mcp 的文件锁归属。
- **PiDurableKit**：把运行时从 WebView 挪到原生 JavaScriptCore，理论上能在 BGProcessingTask 里跑而不依赖 WebView，但它自己没做后台执行，我也没验证可行性。对我们是大改，现在不建议。许可证 CC0，可以用。
- **不能抄代码**：Shurik 和 OpenOrb 没有许可证。其余都是 MIT、Apache 或 CC0，与 PolyForm Strict 不冲突，保留声明即可。

## 没查完的

- 推文说 48 小时内还在提交的相关项目有 9 个，原文我没拿到，不能逐一对上。
- 依赖 pi-durable 的仓库有六十多个，只看了上面这些。botiverse/oar、fabric-runtime/pi-fabric、Parcha-ai/agentrun、mmurakaru/cueloop、OEvgeny/telepi 没读代码。
- pi-durabletask-mcp 是否已发到 npm 没核实。