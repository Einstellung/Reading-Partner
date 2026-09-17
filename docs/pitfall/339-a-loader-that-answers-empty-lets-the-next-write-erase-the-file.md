# 读不出时返回空，下一次写就把整份登记表抹掉

现象：旧的 `slides/store.ts` 里，`retells.json` 一旦解析失败，所有已生成的 deck 从界面上永久消失，没有任何报错；HTML 文件还在盘上，只是没有登记表指向它们了。

原因：`loadRetells` 解析失败时返回空数组当兜底，`recordRetell` 追加前先经它读一遍，于是拿着这份空数组加上新的一条覆写了整个文件。坏读本身不致命，致命的是「读失败」和「还没有文件」在调用方看来是同一个空值，写入方分不出来，就把空版本变成了盘上唯一的一份。同步的文件还会被另一台设备跟着拿走。

解法：内容不能从别处重建的 JSON 一律走 `platform/app/atomic-fs` 的 `readGuardedJson`。内容坏了先把原文件挪成隔离副本再返回兜底，兜底就不会是盘上仅剩的东西；IO 失败（文件在但打不开）不挪、直接抛或报 corrupt，调用方不得在这种情况下写。先读后写的路径（追加、改一行）要把读失败当错误传出去，不能当空列表往下走。现行实现见 `src/reading/rehearsal/store.ts` 的 `loadRehearsalRuns` 和 `src/reading/talk/store.ts` 的 `loadTalkOutline`，测试在 `tests/reading/rehearsal/store.test.ts` 和 `tests/reading/talk/store.test.ts`。
