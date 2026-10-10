# pi-durable 在最后一轮之后取到的 steer 开的是下一个 run，原 submission 先结算

## 现象

pi-durable 1.1.0，纯文字回答流式中 `submit({ whenBusy: "steer" })`：steer 落成 `pi.user` 条目，但 `rp.turn` 落盘的只有第一段回答和这行 steer，steer 的回答没有进对话文件；回合已经结算，对话却还在跑一个新 run。有工具轮的回合里 steer 正常。

## 原因

inbox 只在两个边界取：`postTools`（工具轮结束，取到的 steer 并进当前 run 的 `inputs`，同一个 run 接着生成）和 `final`（`generation.js` 的 `answer()`）。纯文字回答没有 `postTools`，steer 在 `final` 被取：同一个 commit 里原 run `endRun` 结束、它的 submission 以 `done` 结算，取到的 steer 作为输入 `startRun` 开下一个 run。只等原 submission 的 `rp.turn` 就此落盘，下一个 run 的回答没人落。

## 解法

`rp.turn` 等到原 submission 结算后再 `conversation.waitForIdle()`（不看 background 任务，所以不会等自己），等完所有 steer 开的 run 再落盘。落盘把原 submission 之后、requestId 为 `steer:` 且已放下的 submission 都算进本回合：结算状态取最后一个，被看门狗取代和 `rp.partial` 按这一串 submission 判（`src/legion/durable/extension.ts` 的 wait 那步，`turn.ts` 的 `createLandStep`）。被裁成桩的工具结果按对话记、回合结算时清，不按 run。回合期间 `live.run` 没有空档（原 run 结束和下一个 run 开始在同一个 commit），`steerTurn` 照常判忙。
