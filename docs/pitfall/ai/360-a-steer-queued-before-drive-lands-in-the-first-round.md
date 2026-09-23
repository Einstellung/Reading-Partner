# 360 drive 之前塞进去的 steer 会进第一轮，不是第二轮

## 现象

`lane.accept` 拿到 operationId 之后、`lane.drive` 之前调 `lane.steer("...")`，本以为要等第一轮模型输出结束才注入，实测第一次请求的 context 里就带着它了——`entry_added` 在第一次 `before_request` 之前就发了。

## 原因

pi 的队列在每个边界 drain，run 自己的起始边界也算一个（`harness/runtime/drive/boundary.js` 的 `planBoundaryInbox`）。`drive` 开跑前那一刻队列里已经有东西，它就在第一次请求组装前被写进 transcript。

## 解法

不影响正确性——读者的话早一轮进上下文只会更好——但影响界面：注入那一刻要把正在写的 AI 行封口、下面开新行，而此时那行还是空的，会留下一个空行。所以 `use-call.ts` 的注入回调按「行里有没有字」决定要不要切行，没字就继续写同一行。

写这一段的测试要在**第一轮的请求已经在飞**的时候 steer（`scriptStream` 的 round hook 里），不能在 `onSteerable` 里同步 steer——后者测的是上面这条边界，不是读者真实的时机。
