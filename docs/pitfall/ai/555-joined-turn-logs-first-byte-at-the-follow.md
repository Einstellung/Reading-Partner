# 555 接上在途回合时，turn-log 把打开线程那一刻记成首字节

## 现象

书回合工具里杀进程，重启后恢复的回合下一轮 `first-byte` 是 12.8 s（iPad 模拟器）、13.3 s（iPad 真机），而那一轮的 `round` 总时长和正常流完一样，faux 也没有起步延迟。Linux 上重开前等 20 s，`first-byte` 变成 24.3 s：faux 第一个 delta 在请求后 250 ms 就出了，`first-byte` 行写在读者点开课堂线程（`resumedTurn().follow`）之后 180 ms。

## 原因

`DurableTurnLog` 的首字节只由跟随者写（`watchTurn` 的 `pulse` 调 `heard`），没人跟随时这一轮一直「等首字节」。读者打开线程接上回合时，第一张视图里已经是流了一半的回答，`heard` 把它当成第一片，记下的是「请求到打开线程」的时长。关掉对话再重开同理。

## 解法

`resumedPlaceTurn` 的跟随者带 `joining`：第一张视图里已有回答就调 `turnLog.joined`，把这一轮标成听过、不写首字节；第一张视图里还没有回答的，后面照常记。之后的轮次不受影响。单测在 `tests/reading/turn/durable-turn-log.test.ts`。
