# 200 `--console` 挂着的时候，`devicectl` 列不出自己启动的那个进程

## 现象

无人值守的真机跑，每半分钟点一次名：

```
xcrun devicectl device info processes --device "$DEVICE" | grep "Reading Partner.app"
```

一整轮十几次全是空，脚本打了一串 `GONE`。但同一时刻 `idevicesyslog` 还在按秒收我们进程的
`RP-SPEECH` 行，跑完容器里也有完整的结果文件——app 从头到尾没死过。

## 原因

那一轮的启动是 `devicectl device process launch --console`，它会一直占着到进程退出。同一台设备上再并发调
`devicectl device info processes`，回来的清单里就是没有这个进程。点名读的是这份清单，所以「查不到」被当成了
「没了」。

## 解法

有 `--console` 的时候别用进程清单判活。改判日志还在不在长：

```bash
printf '%s last line %ss ago\n' "$(date +%H:%M:%S)" \
  "$(( $(date +%s) - $(stat -f %m "$RUNLOG.app.log") ))"
```

`--console` 那份日志本身也够用：它等到进程退出才收，所以最后一行和 mtime 就是「几点没的」。
装机前那次「还有实例在跑就拒绝安装」的检查不受影响——那时候没有 `--console` 挂着。
