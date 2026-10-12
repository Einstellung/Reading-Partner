# 慢速 faux 的回复计划在重启后的进程里从第一步重来

## 现象

`__fauxPlan` 设成 `["tool","text"]`，在工具里杀进程。重启后恢复的回合下一次调模型拿到的又是第一步 `tool`，于是多调一次工具才回答，看起来像回合重复了。

## 原因

`src/dev-faux.ts` 在页面启动时读 localStorage 建 faux provider，`setResponses` 的下标从 0 开始，按本进程的调用次数走。新进程不知道上一个进程已经用掉了几步。

## 解法

工具已经在跑（`window.__fauxToolLive` 出现）之后、杀进程之前，把 `__fauxPlan` 改成 `["text"]` 并去掉 `__fauxToolDelayMs`，等三秒再 SIGKILL，WebKit 的 localStorage 能落盘。faux 的回答编号也从 `FAUX1` 重新数，读线程文件时别拿编号判断是哪一次调用。
