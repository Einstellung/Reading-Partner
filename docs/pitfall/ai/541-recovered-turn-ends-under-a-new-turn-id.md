# 541 杀进程恢复后，turn-log 的 end 行和 start 行回合号对不上

## 现象

iPhone 模拟器上门口、info、三餐正文中 SIGKILL，重启后 turn-log 补的 `end aborted` 行的 `turn` 和被杀进程写的 `start` 行不同。`tests/soul/door-kill.test.ts` 让子进程把 turn-log 写进文件后复现。

## 原因

`DurableTurnLog` 的回合号是 `begin()` 时现生成的 UUID，只在内存里。被杀进程的号随进程没了，恢复后的 `endUnbegun()` 只能再生成一个，靠 `conversation` 字段配对。

## 解法

`startTurn` 生成回合号，存进 `rp.desk` 的 `turn` 和 `rp.turn` 任务输入的 `turn`。`runPlaceTurn` 的 `begin`、请求钩子（`RequestNotice.turn`，读 desk）、结算回调（`onSettled` 的 `turn`，读任务输入）都用它，重启后的 end 行和原 start 行同号。改之前起的回合没有这个字段，仍现生成。
