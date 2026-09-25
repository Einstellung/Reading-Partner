# 404 拿着旧墓碑的一趟 pass 会把新墓碑刚复活的书从远端删掉，而且永远补不回来

## 现象

双引擎测试（tests/platform/sync/deletion-log-engine.test.ts）：A 删书 h1，同步收敛；B 重新导入同一本，日志追加 revive，写新的 `annotations-h1.json`，跑三轮 settle。A 上日志和 B 一致、h1 不再是死的，但 `annotations-h1.json` 在 A 和远端都没有，B 本地那份也再不上传。

## 原因

pass 的顺序是：列远端、扫本地、读本地日志算 dead、reconcile、执行 purge、再下载。A 那一趟的日志还是旧的（revive 在远端，本趟才下载），所以 reconcile 把远端刚出现的 `annotations-h1.json` 判成死路径，先 purge 了远端，然后才把新日志拉下来。B 下一趟：本地有、远端没有、snapshot 有且本地没改——reconcile 判为「远端删了，本地留着」，不上传（reconcile.ts 的 `note(base.rev)` 分支）。B 不再编辑那本书的话，A 永远拿不到。

## 解法

engine.ts 的 `pullLogFirst`：列完远端、扫完本地之后，先单独对 `deleted-books.jsonl` 做一次 reconcile，是 download 就下载、是 merge 就合并，再重扫本地、算 dead、做正式 plan。日志永远不是死路径也永不推断删除，所以它只会是这两种结果之一；远端没变时一次比较，零请求。
