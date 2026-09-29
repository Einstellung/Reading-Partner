# 排队等 lane 时停摆计时器就过期了，后面那条流没人看着

## 现象

点饭菜页的 Plan this week，回复行一直是 Thinking，从没出现过 "Drafting the week" 这类工具行，也没有报错；点停止没用，换个对话也一样卡。

## 原因

停摆计时器（坑 390）在 `runHarnessTurn` 一开始就注册，但回合要先在 soul 的 lane 上排队（`held.ts` 的 `acquire` 等前一个 `release`）。排队超过 90 秒计时器就触发，这时还没有 lane 和 operationId，`abortRun` 什么也不做，计时器却已经结束了。拿到 lane 之后如果流又静默死掉（iOS 冻进程），这个回合就没有任何保护，一直占着 lane，后面每个 soul 回合都排在它后面。`acquire` 的等待也不看 abort 信号，停止和离开页面都取消不了排队。

## 解法

计时器注册后先 `hold()`，第一次 `before_request` 时 `unhold()`：量的只是供应商的沉默。`acquire` 接收回合的 signal，等待期间 abort 就放弃排队并抛错，自己那一格在前一个回合释放时顺手释放，后面排队的不受影响。测试在 `tests/legion/execute/turn-stall.test.ts`。
