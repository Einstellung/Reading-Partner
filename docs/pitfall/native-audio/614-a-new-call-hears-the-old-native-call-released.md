# 614 新通话先收到旧原生通话的 `released`

## 现象

iPad 静默语音测试 run `zh-chat-then-delegate-2026-10-15T09-46-19-062Z`：第 4 轮 `front:request-sent` 在 96.6 s 发出之后，一直到 900 s 测试台超时，rust.jsonl 和 native.jsonl 都再没有一行：没有 first-byte、没有 model-failed、没有 call-stop，连测试台自己 90 s 的 `step-timeout` 也没来。

下一次 run `en-mixed-2026-10-15T10-01-53-636Z` 一开头就是 `conv:state running=false reason=released turn=4`，接着 `opened`，21 ms 后 `closed`，开场白请求被 abort（"Request was aborted"）。

## 原因

两件事。

第 4 轮之后 webview 的 JS 没了，不是那一个请求卡住：测试台的 90 s 超时是普通 `setTimeout`，JS 活着就一定会打出来；下一次 run 能开始，说明 `voice-harness.ts` 模块级的 `running` 已经重置，页面被重新加载过。原生那边的通话不受影响，一直开着，turn 停在 4。同一批测试的 run 6 前截图是白屏，也是 web 内容进程掉了。

新页面开新通话时，`VoicePlugin.startConversation` 先 `previous.stop(reason: "released")`，旧通话的这条 `state` 走的是同一个插件事件通道，新页面已经订阅了，于是新通话第一句听到的是旧通话的结束，带着旧的 turn。`voice-call.ts` 把它当成自己的结束：`running=false`，再调 `bridge.stop()`，把刚开起来的通话关掉了。

## 解法

`voice-call.ts` 在收到自己的 `state running=true`（`opened`）之前，丢掉一切 `running=false`：原生只有在 `start` 成功之后才开始发事件，第一条一定是 `opened`，在它之前到的结束只能是上一个原生通话的。

另外前台请求加了首字和断流两道限时（`cascade.ts` 的 `FRONT_FIRST_BYTE_MS` / `FRONT_CHUNK_STALL_MS`），JS 还活着时一个不回话的请求最多拖 15 s，按模型失败处理，通话留着接下一轮。
