# 523 线程文件没加载时 append 静默丢掉

## 现象

Linux 桌面（xvfb，真 Haiku）书回合正文中间 SIGKILL，重开 app、打开线程：库里 `rp.partial` 有半句，`rp.turn` 结果是 `{"status":"unanswered","reason":"aborted","landed":true}`，线程文件里却只有读者那句，没有半句。

## 原因

`platform/app/threads.ts` 的 store 按书缓存，`append` 在这本书没 `load` 过时直接 `return undefined`，不报错。启动时 `recoverBeforeResume` 落盘恢复的回合，这时还没有任何界面打开这本书，`bookLander` 和 `landWithdrawnSteers` 的 `threads.append` 全被吞掉，`flush` 也没东西可写；落盘那步照样报 `landed: true`。重启后接着跑的回合读历史（`bookHistoryReader` 退到读文件那支）同样读到空。

## 解法

`BookThreads` 加 `load(home)`，app 的实现调 `loadThreads(home)`；lander、撤回 steer 落盘、读文件历史之前先 `await load`。`tests/reading/turn/support/durable-threads.ts` 的 `fakeThreads(…, { unloaded: true })` 模拟没加载的 store。

测试没抓到，是因为书回合的测试全用 `fakeThreads`，它的 append 从不丢。`tests/reading/turn/durable-kill.test.ts` 用 app 的 `createThreadStore` 落到目录、真 SIGKILL 子进程、重启时 store 没加载，去掉 lander 里的 `load` 就红。

Linux 验收第二次「修了仍不落」是 vite 发的旧代码（坑 403），不是别的原因。
