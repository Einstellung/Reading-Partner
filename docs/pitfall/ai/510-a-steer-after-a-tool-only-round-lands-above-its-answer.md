# 510 只调了工具的那一轮之后插话，插话在界面上跑到自己的回答下面

## 现象

三餐对话里第一轮只调 `update_meals_profile`、一个字没写，这时用户插一句「Also keep breakfasts under 400 kcal.」。回合跑完，界面上是 提问 / AI 行（回执 + 卡片 + 回答）/ 插话；重开后是 提问 / 插话 / AI。文件里是 `user / user / ai '' [card] / ai "I've set your diet…" [trace]`，最后那条 AI 行带着提问的 ts，比插话早。书那边（`use-call.ts`）同样如此。

## 原因

`turn-row-split.ts` 的 `steered(head)` 按「行里有没有字」决定切不切（坑 360）：没字就不切，回答接着写进同一行。界面上那一行在插话上面，插话交给模型时 `deliverRows` / `row-delivered` 只摘掉排队标记、不挪行，于是回答留在插话上面；文件里那一行要等 `onDone` 才写，排在插话后面，ts 却还是第一行的。行里只有回执时同样算「没字」。

## 解法

交接时判的是「这一行产出过东西没有」，和停止键 `keptOnStop` 一个标准：有字或有已结束的工具调用都算。算产出的行原地封口、带 trace 写进文件，下一次写入在插话下面开新行，ts 取插话之后。什么都没有的行不留在插话上面：下一次写入时把它删掉（`WritingAt.split.drop`，书那边是 `row-split` 的 `drop`），新行同样开在插话下面、ts 在其后，文件里不为它写任何东西。`delivered` 用同一判据，交接的行同样带 trace 落盘。卡片（`raiseCard`）插在正在写的行上面、落盘时排在回答前面，切行之后自然落在插话和回答之间。卡片的 ts 原先取 `Date.now()`，和同一毫秒开的回答行撞号时 `patchAiRow` 按 ts 把回答的字也写进卡片行，改成用 hook 自己的 `stamp()`。书那边的停止键原先不看行是否已落盘，交接后立刻停会把同一行再写一遍，改成和 `useStreamingTurn` 一样看 `split.down`。
