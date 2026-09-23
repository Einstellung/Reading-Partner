# 同步停了，状态文件却一切正常（四天没人发现）

## 现象

PC 上的批注一直没同步到 iPad，但备课、记忆、聊天线程都在。查 AppData：

- `sync-state.json`：`autoSync: true`、`lastError: null`、`lastSyncAt` 停在四天前、Drive id 有 41 条（说明确实同步过）
- `annotations-*.json` 的 mtime 比最后一次同步还晚两天
- `sync-auth.json` 不存在

设置页照常显示「Sign in with Google」的推销文案，别处没有任何提示。用户以为一直在备份。

真实成因是一次自己下的指令：为了测试 info 首启引导，让 agent 把凭据文件临时 `mv` 进备份目录（`~/reading-partner-info-backup-20260722/`），说好测完挪回来，然后忘了。凭据文件的 inode ctime 与 agent 执行 `mv` 的时刻精确对上。

## 原因

启动只有一句 `if (configured && signedIn && autoSync) start()`。凭据没了 `signedIn` 就是 false，引擎从不启动；而 `lastError` 只由「跑过的一趟失败了」写入，一趟都没跑就永远是 null。于是「自动同步开着」和「什么都没在跑」这两件事同时为真，磁盘上却没有任何字段记录这个矛盾。

引擎跑起来之后凭据失效反而是安全的：`getAccessToken` 抛 `GoogleAuthError`，引擎落到 `onSignedOut`，UI 会提示重新登录。只有「启动那一刻就没有凭据」这条路是静默的。

还有一处不好分辨：`signOutOfGoogle`（用户主动退出）不关 `autoSync`（docs/13 保留这个偏好），所以「主动退出」和「凭据丢了」在 `signedIn` + `autoSync` 两个标志上完全一样。区分点是 `lastSyncAt`——主动退出会清成 null，凭据丢失会留着。

## 解法

判断收口到纯函数 `src/platform/sync/health.ts`，`.tsx` 只渲染结论：

- `syncStartAction`：启动时三选一。`start` / `record-stopped`（自动同步开着但没凭据且本机同步过，把原因写进 `lastError`）/ `idle`。
- `syncHealth`：给状态 + 时钟，返回该说什么。未配置、自动同步关闭、主动退出一律不出声；一趟失败是 notice（多半只是断网）；凭据丢失、引擎没跑、超过一天没成功过是 alert。判「太久没同步」要先过 10 分钟的启动宽限期，否则关了一周再打开必误报。

到达用户的方式沿用已有的东西：alert 每次启动弹一次 toast（只一次），notice 和 alert 都在设置入口（首页齿轮、阅读页 More）上挂一个点。不做常驻横幅、不做模态框。

`SyncStatus` 多了 `engineStarted` 和 `startedAt`——「引擎在跑」和「登录了」不是一回事，状态里必须能分开。
