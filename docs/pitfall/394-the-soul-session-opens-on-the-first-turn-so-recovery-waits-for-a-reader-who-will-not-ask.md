# soul 的 session 只在「第一个回合」时才开，于是被杀那轮的恢复在等一个不会再开口的读者

## 现象

坑 390 和 391 修完以后，在 iPad 模拟器上跑「回合中途 `simctl terminate`，再 relaunch」：

- 死之前 DOM 里已经有 8591 字正文，soul 的 session 文件里 502 条 `text_delta` 都在盘上。
- relaunch 之后线程文件停在 497 字节（只有用户那句提问，零条 AI 消息），三分钟不动。
- 不是「只落了收尾一段」（那是坑 391 的样子），是**一个字都没落**。

单测全绿，`saidBefore` 本身也对——它根本没被调用过。

## 原因

`recoverSoulSession` 是 `holdHarness` 的 `recover` 回调，而 `holdHarness` 里那个 `handle ??= …` 在 `open(turn, context)` 里，`open` 只有 `acquire` 会调。`acquire` 只有一个调用者：一个真的回合。

所以恢复的触发条件是「这个进程跑了第一个回合」。而被杀那条路上，进程重启后谁都不会跑回合：读者回到的是一个只有自己那句话、下面空着的线程，他们最没有理由再问第二个问题。于是 session 没开，`recover` 没跑，写在盘上的半篇回复就留在那儿。

容器里能直接看出来：`session/--session-soul--/` 下面，被杀那次的文件有 `reading-partner.delivery` 印记、有 `start` 没有配对的结束，而它旁边**没有**新的 session 文件——relaunch 之后的那个进程从来没有开过 soul 的 session。倒过来也能对上：上一轮被杀留下的 session，是在下一轮脚本重新发问的时候才被恢复的（那份文件里有 `reading-partner.recovery-attempt`）。

## 解法

进程起来就开 session，不等回合。

- `src/legion/execute/held.ts` 的 `HeldHarness` 多一个可选的 `open(turn, context)`：走同一个 `open`，开完就返回，不借 lane。`recover` 照旧不被 await。
- `src/soul/harness.ts` 的 `startSoulSession()` 造一个种子回合——harness 在创建时就把 model registry 定死了（坑 307），所以必须给一个 model，从 settings 里的默认 provider/model 解出来。种子的 `streamFn` 直接抛：真正 resume 的那个回合自带 model、提示词和工具（`recover.ts`），没有任何一轮会流经种子。解不出来（没配 provider、settings 读不出来）就打一行 warn 丢掉：没人在等这个，而且没有凭证也无从 resume，第一个回合照旧会把 session 开起来。
- `src/App.tsx` 和 `src/PhoneApp.tsx` 各挂一个启动 effect 调它。

代价是每次启动多一次目录列举和一个 session 文件，`sweepSessionGroup` 本来就按 `KEEP_SESSIONS` 封顶。

顺带补上的：`PhoneApp.tsx` 之前没有 `watchAppAwayForStalls(window)`，坑 390 的「回前台立刻掐」那条边在手机壳上一直没生效。

测试：`tests/legion/execute/held.test.ts`（只 `open` 不 `acquire`，`recover` 拿到上一个进程的 open run；没人 `open` 时第一个回合照旧开 session；`open` 两次只开一个 session）、`tests/soul/harness.test.ts`（开不起来不抛）。

关联坑：390、391、307。
