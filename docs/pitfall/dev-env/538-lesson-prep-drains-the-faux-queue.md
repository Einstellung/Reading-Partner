# 平板课堂的章节预备把慢速 faux 的 40 步吃光

## 现象

iPad 模拟器上第一次打开一本书的课堂（「Learn this book with AI」），顶上显示「Preparing 0/63」。之后读者回合正常流式几轮，再发问时回合直接失败，turn-log 里是 `end reason: error`、`No more faux responses queued`，`__fauxCalls` 已经过了 40。

## 原因

`src/dev-faux.ts` 只排 40 步回复。课堂打开后逐章做预备（turn-log 里 `surface: "notes"`），每章一次模型调用，也走被替换的 anthropic provider，和读者回合抢同一个队列。63 章的书一次就能把队列用完。

## 解法

验课堂前先让预备跑完：把 `__fauxTps` 设成 5000，重启 app、打开课堂，等 `surface: "notes"` 不再出新的 `start`（队列不够就再重启一次，新进程重新排 40 步），再把 `__fauxTps` 改回慢速、重启开始验。
