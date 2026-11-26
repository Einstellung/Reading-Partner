# 在途回合的 place 不再登记时，重开静默丢掉它

## 现象

info 对话的回合答到一半被 SIGKILL，重开时 `openReadingDurable` 的 `places` 里不再有 `info`（只登记 `meals`）。打开不报错，`recovered` 照样是 `["mid-text"]`，活任务随即清空，模型没有被再调一次；但半句没有落进 `threads-info-<日期>.json`，文件里只剩读者那一行。没有日志，没有卡片。

## 原因

`openDeviceDurable`（`legion/durable/device.ts`）按登记的 place 建 resolvers 和 landers，`readHistory`、`onSettled`、`fileWithdrawnSteers` 都是 `places.get(origin.place)` 取不到就跳过。回合照常结算，只是没有谁去落盘。

## 解法

删一个 place（这次删 Intel 的 `info`）时可以直接从 `places` 里拿掉，启动不会因为盘上的旧回合出错；代价是那条回合的半句丢掉。要保住半句，就得留着该 place 的 lander 到旧回合都结算完。探针：拿 `tests/info/briefer/info-kill-child.ts` 杀一条 info 回合，再只用 `{ meals }` 打开（2026-11-25，pi-durable 1.5）。
