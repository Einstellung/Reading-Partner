# 234 后台蒸馏/画像失败只留下 unknown，日志里查不出原因

## 现象

2026-09-06 起，桌面上每 30 分钟一次的定时任务全部失败，连续 12 小时。事件日志里每条都是同一行：

```
{"type":"distill-failed","trigger":"timer","stage":"run","reason":"unknown","outcome":"failed","from":0,"to":126,...}
{"type":"guess-failed","trigger":"timer","outcome":"failed"}
```

`reason` 恒为 `unknown`，`guess-failed` 连 reason 都没有。日志说不出是没网、没凭据、模型 ID 不存在还是请求被拒。

## 原因

三层各丢一次信息：

- `runAgentTurn` 的 catch 只把 `e.message` 交给 `onError`，错误对象本身（构造函数名）当场丢掉。
- `runSubagent` 把消息拼进给人读的 brief 句子，`SubagentBrief` 不带原始消息。
- `live.ts` 记 `distill-failed` 时只传 `outcome`，不传 error；`classifyDistillFailure` 的 switch 对 `"failed"` 没有分支，落到用错误文本匹配的那段，而文本是空的——所以**凡是 `outcome: "failed"` 必然记成 `reason: "unknown"`**，与真实原因无关。

顺带两条读日志的事实：

- `prompt-cache` 是每个**拿回过 assistant 消息**的 round 记一行（provider 报错也记，`ok:false`）。失败期间一行都没有，说明请求根本没发出去或没拿回任何消息——失败在 `resolveCall`（凭据、模型查表）或 pi 的同步校验里，不是模型拒答。
- `distill-failed` 的 `from` 是**当时** `observations/meta.json` 里的游标。这个文件是同步文件，另一台设备可以整份换掉它。事后看到 `from: 0` 而 meta.json 里那条线程写着 42，不是 pass 算错，是游标在这中间被换过。

## 解法

- 失败事件带上错误自己的身份：`errorName`（构造函数名）+ `errorMessage`（前 200 字），`distill-failed` 和 `guess-failed` 同一对字段。`reason` 那个分类字段留着不动。
- 只有 `outcome: "failed"`（或根本没跑到 run 的 setup 阶段）才带这两个字段。其余 outcome 的消息是模型自己写的，会引用它正在读的东西，结构上挡掉而不是靠约定（`failureIdentity`）。
- 传递路径：`AgentCallbacks.onError` 多一个可选的 `thrown`，`SubagentTurnOutcome` 的 error 分支多一个 `name`，`SubagentBrief.failure` 带 `{name, message}`。brief 那句话仍然不进日志。
