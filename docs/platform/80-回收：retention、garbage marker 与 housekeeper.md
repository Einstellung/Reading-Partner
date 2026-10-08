# 回收：retention、garbage marker 与 housekeeper

2026-09-27 定。回收拆成三件：palace 每行写 retention，garbage marker 判哪些该走，housekeeper 每晚执行。读者手动删除（[50](./50-删除.md) 的墓碑、立即生效）不归这里，两边只共用 platform/sync 的同步安全删除。

## retention

palace 行上的 `retention` 字段（`src/palace/kinds.ts`），取代原来只登记不动作的 `gc`。七种：

| rule | 意思 | 谁执行 |
|---|---|---|
| `never` | 不回收 | 无 |
| `age` | 超过 N 天删；从 mtime 算或从文件名里的日期算（行的 id 是 `date` 才能用后者） | housekeeper 自带的通用 marker |
| `keep-last` | 同目录按 mtime 或文件名排序，留最新 N 个 | 通用 marker |
| `tail` | 只留最后 N 行 | 通用 marker |
| `with-parent` | 随父对象的删除流程走，行上写父 kind 和那段代码（文件 + 函数名） | 那段代码，立即执行 |
| `inline` | 已有的即时流程把它限住了，行上写那段代码 | 那段代码 |
| `marker` | 由某个领域登记的 garbage marker 判，行上写 marker 名 | 那个 marker |

守卫测试（`tests/housekeeper/retention-guard.test.ts`）：每个不是 `never` 的行，要么是通用规则，要么点名的 marker 已登记，要么点名的文件里真有那个函数。还没写 marker 的行列在测试里的待办名单上，名单只许变短。

## garbage marker

纯函数：通过注入的只读 io 看盘、看时钟，交出一串 `{ path, action, reason }`，`action` 是 `delete`、`truncate-tail`、`demote-local` 之一。它不碰盘。标记不落盘，每晚重算；宽限期从盘上已有的时间戳算，不另存。

领域在启动时 `registerGarbageMarker` 登记自己的 marker（`bootDomains`，和 `registerDistillSource` 一个做法）。housekeeper 只执行一个 marker 对自己名下那些行的标记：标记的路径解析到的行，retention 必须点名这个 marker（通用规则的行归通用 marker），否则拒绝并记日志。`never`、`inline`、`with-parent` 的行和 palace 不认识的路径一律拒绝。

[58](../soul/58-蒸馏器与dream.md) 的 memory/gc 将来就是 memory 登记的一个 marker，判据是蒸馏水位加溯源账本；账本还没有，这个 marker 先不写。

## housekeeper

`src/housekeeper/`，capability 层，只 import platform 和 palace。

每晚一次：挂在 legion/schedule 的本地夜间任务上（`registerNightlyJob`，每台设备都跑，不选举，锚点记在本机的 `legion/schedule/fired.json`）。触发它的是外壳后台服务里的 `startScheduleClock`（`useBackgroundServices`）：启动时、每五分钟、回到前台时各问一次钟。原先这个 tick 挂在 info 的 `checkDailyRound` 上，而 info pipeline 只在收集机上构建，阅读机（手机、平板）从没跑过夜间任务。

执行按行的同步通道分：

- `local`：直接删。
- `data` / `books`：先 `requestRemotePurge()` 再删本地（坑 [208](../pitfall/storage/208-file-deletion-does-not-survive-sync.md)）。所有回收都用这个顺序：中途断掉时本地文件还在，下一晚重新标出、再请求一次；反过来先删本地，断在两步之间就没有东西能再标出它，远端那份留到永远。先请求后删本地的窗口里同步可能把它又传上去一次，下一晚同样收回。每晚的远端删除有请求预算，超了留到下一晚——文件还在盘上，下一晚会被重新标出来。
- `remote-only`：拒绝。
- `truncate-tail` 只对 `local` 做。同步文件截尾没有现成的安全做法，拒绝并记日志。
- `demote-local` 只定义了动作，没有冷层，执行时记一条「未实现」。

每个动作在本地 `housekeeper-log.jsonl` 记一行（路径、marker、规则、理由、结果）。这个文件不同步，retention 是 `tail`，由 housekeeper 自己截。

## 现状

在跑的 marker：

| marker | 行 | 判据 |
|---|---|---|
| 通用 | `cover-failure-unreadable`、`soul-sequence`、`housekeeper-log`、`events` | 封面失败标记 30 天；`soul-sequence.json` 已没人读写，最后一次写入后 7 天；日志和 `events-*.jsonl` 各留尾部（2000 / 5000 行）。`events` 没有代码回读，是给人看的仪表 |
| `legion-run-files` | `run`、`run-brief`、`run-output` | run 文件：ledger 有它的行（`tombstonedRunIds`）。brief / output：没有任何 hot run 指向它，且 mtime 超过 7 天；折叠过的和孤儿一条规则 |
| `legion-bell` | `bell` | 已 ack 且 ack 后 14 天。重响只发生在 run 还热或 tick 响铃未记账时，run 最迟 ack 后 7 天折叠 |
| `info-daily-files` | `info-cables`、`info-daily-{briefing,articles,items,run}` | 今天以外的日切文件；cables 30 天 |

ledger 折叠写 ledger 行，不是纯 marker：它是 legion 自己的夜间任务 `LEDGER_FOLD_JOB`，同一时刻注册在 housekeeper 之前，折完当晚 run 文件就被 marker 标走。info 生成前的 prune 和阅读机启动时的 prune 都删了，重新分诊从来不 prune 的缺口也随之不存在。`info-daily-pool` 仍由 collector 的 `removePoolDays` 即时处理。

没回收、行上写 `never` 的：

- `info-feedback.jsonl`：同步的按行 records 文件。一台设备截尾，有 base 的对端会把删掉的行当删除接受并逐条记进 sync-trash，没有 base 的设备（新设备、base 丢了）会把行并回来。安全截尾需要新机制（水位或墓碑），没做。
- `sync-holdings/<deviceId>.json`：退役设备的 holdings 一直在远端，删了本地缓存，下一轮同步又会拉回来。要回收得先有「退役设备」这件事（删远端的 holdings），没做。

冲突副本：`conflictCopyPath` 除了 prose 合并，还在 `mergeOpaque` 里写——opaque 行（retell、rehearsal、pagination、info-cables、info-picture、info-meals、info-ask、claim、article-bodies 等）以及任何结构化合并读不懂时退回 opaque 的文件（run、box、线程）。这些副本在各自目录里 `<stem>.conflict-<digest><ext>`，palace 不认，prose 裁决（`candidateDirs` 只看 observations、根目录、`prep-*` 和其 `chapters`）也不看，没人处理。副本里是用户内容，不做删除 marker；怎么收是待办。prose 裁决的扫描本身也挂在 info 的 `checkDailyRound` 上，只在收集机跑。
