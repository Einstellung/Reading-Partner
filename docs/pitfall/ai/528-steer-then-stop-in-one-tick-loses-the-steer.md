# 528 插话后同一刻按停止，插话丢失

## 现象

info 对话的 hook 测试（faux，`tests/ui/components/info/info-call-turn.test.ts`）：回合流式中发一句话，紧接着按停止。半句落盘，但那句话既没进对话文件，也没留在屏幕上，下一回合也没开。

## 原因

`legion/durable/turn.ts` 的 `steerTurn` 先查 `isRunning` 再 `conversation.submit`，`stopTurn` 读 `InboxDoc` 快照取还没被取走的 steer 再 `abort`。两者同时发出时，`stopTurn` 读快照早于 steer 进 inbox，于是没撤回它；steer 的 promise 仍返回 true，`place-session.ts` 把它从待写清单里删了。这句话最后进了一个已经停下的对话，谁也不落。

## 解法

`place-session.ts` 记下每个还在提交中的 steer，`stop()` 和 `leave()` 等它们都返回后再调 runtime 的 stop，这时 steer 已在 inbox 里，`stopTurn` 照常撤回、写文件、开下一回合。书的两个界面（`session/use-call.ts`、`phone/lesson/use-lesson-call.ts`）不走这个控制器，已修：拿到 runtime 的句柄就用 `reading/turn/steer-gate.ts` 的 `gateSteers` 包一层，停止同样等在途 steer 返回。
