# pi-durable 1.5 先把半句给界面看、后落盘，被杀后重开的半句比读者看到的短

## 现象

pi-durable 1.5.0，`persistWithinMs: 0`。子进程在对话视图（`Conversation.watch()`，`followActiveView`）显示 200 字时被 SIGKILL，重开后 `pi.live` 里存下的半句是 196 字（门口那条是 164 字）。读者看到 200 字，重启后落进对话文件的是 196 字。没设 `persistWithinMs` 时（默认 1000 ms）一次都没存上，恢复判成 nothing，半句整段丢。

## 原因

1.5 把流式 partial 和工具运行输出做成延迟提交（`CommitPersistence`）：提交先在内存里采纳并立刻发给 watch 和视图，再排进下一次存储。`persistWithinMs: 0` 只是让存储紧跟着排，界面仍然先于磁盘一拍。1.1.0 是先存后发。

## 解法

`harness.ts` 设 `persistWithinMs: 0`，把差距压到最多一个 partial（`partialIntervalMs` 100 ms 的字）。重开时落的是存下的那段，不重问。要完全消掉得让界面只画已存的提交（`Session.observeCommits()`），显示会晚一次存储往返，没做。

测试里杀进程的时机按已存内容判：`tests/legion/durable/support/stored-text.ts` 的 `whenStoredText` 看 `observeCommits()` 里的 `pi.live`，不看视图。
