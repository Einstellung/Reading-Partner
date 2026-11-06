# 692 三餐状态的副本没有版本号，parseMealsFile 把它读成空的

## 现象

`info-meals` 的 entry 用 `parseMealsFile` 读模型交回的值，改鸡肉锅 `rawG` 的程序被退回「only a plan the planner drafted can be changed here」：交回的值里明明有 `plan.planner`，检查却看到 `plan` 为 null。

## 原因

`open` 交给沙盒的副本是 `parseMealsFile` 读出的 `MealsState`，不带文件顶层的 `version`。`parseMealsFile` 对 `version` 缺失或小于 `MEALS_VERSION` 的值按旧版文件处理，只留 `photosAskedAt`，其余读成空状态，不报错。

## 解法

`parse` 读交回的值前补上当前版本：`parseMealsFile({ ...value, version: MEALS_VERSION })`（`info/meals/writable.ts`）。`restore` 读的是版本记录里的整份文件文本，本来带版本，不用补。
