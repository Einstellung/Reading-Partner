# 一趟同步全有或全无，链路一丢包就永远同步不完

## 现象

iPad 设置页：Google 账号对、「Sync automatically」开着、`Last sync: Never`，红字写

```
No sync has succeeded for over a day. Last error:
error sending request for url (https://www.googleapis.com/drive/v3/files/19j-g6A-…?alt=media)
```

同账号的桌面端几分钟前刚同步成功，远端 manifest 和桌面快照对得上，51 个数据文件全在。iPad 的网络能连上 googleapis（这一趟已经跑完了 ensureLayout 和 listManifest），只是丢包。

三处都不对：

- `error sending request for url (…)` 是 reqwest 的传输失败文案，不是 HTTP 状态错误——`ok()` 会说 `Drive download failed (HTTP 404)`。这个请求根本没完成。
- URL 里那个 file id 用本账号的 token 查是 404 File not found，且不对应账号里任何一个文件（不是 manifest、不是 51 个数据文件、不是 3 个书 blob）。是上一个纪元残留在本机 `sync-state.json` 里的幽灵 id。
- `Last sync: Never` 却说「超过一天没成功过」——`lastSyncAt === null` 时那句话是编的，刚登录十分钟的设备也是这个状态。

## 原因

`runPass()` 是全有或全无：一个文件传输失败就抛出，剩下的下载、全部上传、`writeManifest`、书通道一概不跑，`lastSyncAt` 永不前进。

链路每个请求有独立失败概率 p 时，一趟要 N 个请求，成功率是 (1-p)^N。p=5%、N=50，一趟成功率 7.7%；p=10% 就只剩 0.5%。于是「每个请求单看都能成」和「一趟都没成过」同时为真。桌面端 p≈0，所以完全看不出来。

幽灵 id 让这件事从概率问题变成永久问题：`driveBackend.ts` 把 Drive file id 缓存进 `sync-state.json` 后从不重新解析，文件在远端被删掉或重建，这条 id 就永远指向空，`ok()` 把 404 抛出来毒死之后每一趟。没有任何自愈路径。

还有两处放大：全程没有重试也没有超时，一次抖动就废掉一趟，一个挂住的请求把 UI 永久钉在「Syncing…」。

## 解法

`runPass()` 改成逐项：单个下载或上传失败只算它自己，其余文件、manifest 写入、书通道照跑。约束是「不许比实际做到的多说」：

- `writeManifest` 只发布真正落地的上传。给没传上去的文件写 rev，等于告诉其他设备「你已经是最新的了」，而那份内容不存在，同时本机那份也不再被提供出去。
- 快照只记真正传完的项，且上传要等 manifest 写成功后才进快照——字节在 Drive 里但 manifest 不提它，对其他设备等于不存在，必须看起来像没传过、下一趟重来。
- `lastSyncAt` 只在一趟一个都没失败时前进（health 的过期判断就靠这个含义）。部分失败把「几个失败 + 第一条消息」写进 `lastError`。
- 认证错误（`GoogleAuthError`，仍按 name 结构匹配）照旧立即中断整趟并触发登出，不吞成单项失败。
- 连续 3 项失败就判定链路已死，剩下的留给下一趟，免得在断网设备上一趟磨几十分钟。

`driveBackend.ts` 加缓存 id 自愈：用缓存 id 发的请求回 404 就忘掉这条 id、按名字重搜、持久化、用新 id 重试一次。名字在远端也没了的话，下载抛 `RemoteGoneError`（引擎当作跳过而不是网络故障——重试变不出来，把它算成故障会为一个无法修复的状态永久报警），上传则创建。数据文件、manifest、书 blob 三条路都走这个。

失败分三类，在代码里区分而不是匹配文案：`SyncTransportError`（没拿到状态）、`SyncHttpError`（带 status）、`RemoteGoneError`。重试只针对传输失败和 408/429/5xx，退避 500ms / 1500ms。小 JSON 和数据文件 3 次尝试、单次 20s 超时；书 blob 2 次、不设总超时（26 MB 在慢链路上本来就要几分钟）。连接超时统一 10s。

超时用 `AbortSignal` 实现：`@tauri-apps/plugin-http` 2.5.9 的 JS 侧认 `signal`（发送阶段和读 body 阶段都挂了 abort 监听），`connectTimeout` 在 Rust 侧进 reqwest 的 `connect_timeout`——只管建连，不是整个请求的期限，所以两者都要。

错误文案带上文件名：`download annotations-<hash>.json failed: …`。只给 URL 的话人看不出是哪个文件。

`health.ts` 把「本机从未同步成功过」和「超过一天没同步」拆成两个状态：`never-synced` 说「This device has never completed a sync.」，`stalled` 的一天措辞只在 `lastSyncAt` 非 null 时用。
