# 529 语音打断后立刻问下一句，撞上还在落盘的上一回合

## 现象

info 语音通话搬到 durable 运行时后的测试（faux，`tests/reading/turn/info-voice.test.ts`）：开场白还在说，读者插话（`speech-end`），下一回合起不来，报 `TurnBusy`（a turn is already running in this conversation），语音状态机收到 failed 回到 listening，读者那句没有回答。

## 原因

状态机在 `speech-end` 里先 `cut`（发 `abort`）再 `ask` 下一回合，两个效果同一批执行。`abort` 只是让运行时停，停下的回合还要把半句落盘、结束 `rp.turn`，这期间对话仍算忙，紧跟着的 `startTurn` 就被拒。即使不被拒，下一回合的历史读的是线程文件，上一回合的半句还没进去。

## 解法

`reading/turn/info-voice.ts` 把一通电话的回合串起来：下一回合先等上一回合整个结束（落盘、按听到的部分改写之后）再读历史、装配、起回合。
