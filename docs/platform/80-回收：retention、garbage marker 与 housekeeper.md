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

每晚一次：挂在 legion/schedule 的本地夜间任务上（`registerNightlyJob`，每台设备都跑，不选举，锚点记在本机的 `legion/schedule/fired.json`）。触发它的仍是 `runScheduleTick` 所在的那个五分钟 tick。

执行按行的同步通道分：

- `local`：直接删。
- `data` / `books`：先 `requestRemotePurge()` 再删本地，和 legion ledger 的顺序一样（坑 [208](../pitfall/storage/208-file-deletion-does-not-survive-sync.md)）。每晚的远端删除有请求预算，超了留到下一晚——文件还在盘上，下一晚会被重新标出来。
- `remote-only`：拒绝。
- `truncate-tail` 只对 `local` 做。同步文件截尾没有现成的安全做法，拒绝并记日志。
- `demote-local` 只定义了动作，没有冷层，执行时记一条「未实现」。

每个动作在本地 `housekeeper-log.jsonl` 记一行（路径、marker、规则、理由、结果）。这个文件不同步，retention 是 `tail`，由 housekeeper 自己截。

## 现状

通用规则今天在跑的：封面读不出的失败标记（30 天）和 housekeeper 自己的日志。legion 的 run 折叠和 info 日切文件的清理还在原处，行上写 `inline`，之后迁成 marker。等 marker 的：`events`、`info-feedback`、`bell`、`run-brief`、`run-output`、`sync-holdings`。
