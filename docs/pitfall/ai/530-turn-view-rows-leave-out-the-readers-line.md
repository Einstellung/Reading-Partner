# 530 回合的 view 行不含读者那句

## 现象

info 文本对话开着时，语音回合在它的 place session 里跑（`tests/reading/turn/info-voice.test.ts`）：对话里流式出现回答，上面没有读者说的那句。

## 原因

`drivePlaceTurn` 给的行来自回合的 view，只投影这次运行产生的行（回答、工具、插话），作为 prompt 的读者那句不在里面。文本界面自己先把那句画进屏幕、写文件再 `ask()`，所以从没缺过；语音那句是转写写进文件的，界面的镜像里没有。

## 解法

`place-session.ts` 的 `voice()` 把那句（带 ts）记在回合上，每次画行都放在回合行前面；语音那边以 `lineTs - 1` 作 `after`，界面已有同 ts 的行时由 `withPlaceTurnRows` 合并，不重复。
