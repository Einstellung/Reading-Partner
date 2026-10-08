# delete process.env.TZ 不会把进程时区改回去

## 现象

全量 `scripts/t.sh` 里 `tests/workshop/bindery/article-bytes-pin.test.ts` 红，哈希是 Asia/Shanghai 的字节而不是钉死的 UTC 字节；单跑绿。

## 原因

`bun test` 启动时 `process.env.TZ` 是 `undefined`，进程时区却是 UTC。`tests/platform/std/day.test.ts` 逐用例设 `process.env.TZ = "Asia/Shanghai"`，`afterEach` 在原值为 `undefined` 时 `delete process.env.TZ`。bun 1.3.11 上 `delete` 只清掉环境变量，不触发时区重算，进程停在最后设过的时区，后面所有文件都在那个时区里跑。

bindery 的 `FIXED_MTIME` 在模块加载时按本地字段算出，fflate 在打 zip 时再按本地取值器写 DOS 时间，两个时刻之间时区变了，字节就变（见坑 293）。

探针里 `process.env.TZ = "Etc/UTC"` 同样没切回去，`"UTC"` 切回去了。

## 解法

文件加载时记下实际生效的时区：`Intl.DateTimeFormat().resolvedOptions().timeZone`，`afterEach` 里把 `process.env.TZ` 赋回这个值，不用 `delete`。改过 `process.env.TZ` 的测试文件都这样收尾。

相关：[293](../storage/293-a-fixed-zip-mtime-is-not-fixed-across-time-zones.md)
