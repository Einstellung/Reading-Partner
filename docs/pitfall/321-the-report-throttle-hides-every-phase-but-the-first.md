# 321 run 的 progress 节流把第一行之后的相位变化全吞掉

## 现象

collect worker 把管线的四个相位各翻成一行 `ctx.report`。跑到 analyzing 时去读 run 文件，`progress` 还是第一行 `collecting sources`；中间两行一个字都没落盘。把测试的时钟钉在一个常数上时，除了第一行和终态那一行，run 文件再不变。

## 原因

`createReporter`（`src/legion/execute/runner.ts`）每个 run 每 30 秒只写一次盘：第一次 `report` 必写，之后窗口内的只更新内存里的 `line`，`store.report` 根本不调。终态那一次不受节流，带上最后一行。所以一条几分钟里换四次相位的 run，盘上看到的是第一行，然后直接跳到最后一行。

这是 docs/55 写好的行为（「同一个 run 最多每三十秒写一次盘」），代价是相位这种一分钟内连着变几次的进度在盘上看不见。管线自己的进度卡不受影响，它订阅的是 pipeline 不是 run 文件。

## 解法

要断言中间的行，测试里把时钟推过 30 秒再制造下一次变化（`clock += 31_000`），别用固定时钟。

产品侧别把 run 文件的 `progress` 当成逐步进度条用：它是「跑到哪了」的一句话，不是事件流。要逐步的就订阅领域自己的 snapshot。
