# 523 线程文件没加载时 append 静默丢掉

## 现象

Linux 桌面（xvfb，真 Haiku）书回合正文中间 SIGKILL，重开 app、打开线程：库里 `rp.partial` 有半句，`rp.turn` 结果是 `{"status":"unanswered","reason":"aborted","landed":true}`，线程文件里却只有读者那句，没有半句。

## 原因

`platform/app/threads.ts` 的 store 按书缓存，`append` 在这本书没 `load` 过时直接 `return undefined`，不报错。启动时 `recoverBeforeResume` 落盘恢复的回合，这时还没有任何界面打开这本书，`bookLander` 和 `landWithdrawnSteers` 的 `threads.append` 全被吞掉，`flush` 也没东西可写；落盘那步照样报 `landed: true`。重启后接着跑的回合读历史（`bookHistoryReader` 退到读文件那支）同样读到空。

## 解法

`BookThreads` 加 `load(home)`，app 的实现调 `loadThreads(home)`；lander、撤回 steer 落盘、读文件历史之前先 `await load`。`tests/reading/turn/support/durable-threads.ts` 的 `fakeThreads(…, { unloaded: true })` 模拟没加载的 store。

这一条修了之后实测半句仍没进线程文件（Linux 验收第二次），还有别的原因没查明，见 `docs/research/pi-durable-迁移交接.md`「Linux 桌面验收」。
