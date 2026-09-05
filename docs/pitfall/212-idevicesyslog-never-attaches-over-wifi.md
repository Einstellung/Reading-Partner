# 212 WiFi 连接下 `idevicesyslog` 根本挂不上，而且不报错

## 现象

无人值守的真机跑，日志通道起来了：

```
( nohup idevicesyslog -u "$DEVICE" -p "$DEV_NAME" > "$RUNLOG.app.log" 2>&1 </dev/null & )
```

`pgrep -fl idevicesyslog` 找得到进程，脚本一路往下走。但 `.app.log` 和 `.sys.log` 从头到尾只有一行：

```
Waiting for device with UDID ... to become available...
```

不报错、不退出、也不重试，就那么挂着。同一时刻 `devicectl` 装包、推夹具、`--console` 拉起 app 全都正常。

第二重症状更害人。脚本里那个判活计数（坑 200 定下来的做法）读的是这个文件的 mtime：

```bash
printf '%s last line %ss ago\n' "$(date +%H:%M:%S)" \
  "$(( $(date +%s) - $(stat -f %m "$RUNLOG.app.log") ))"
```

文件一直停在创建时写的那一行，于是这个数从文件创建那一刻起单调增长。一轮跑到 667 秒的时候它显示
「last line 667s ago」，读起来像 app 十分钟前就死了——而 app 一直活着，跑完自己的腿之后才 SIGABRT。
按这个数去查「app 什么时候死的」，查的是一个不存在的死亡时刻。

`idevicecrashreport` 一样什么都拉不到，`~/crash` 里最新的还是一周前那一轮。

## 原因

`idevicesyslog` 走的是 usbmuxd 的 lockdown 连接。设备只经 WiFi 可达时它等的那个设备不出现，
就停在 `Waiting for device` 上。它把这当成正常的等待状态，不是错误：不打 stderr、退出码没有、进程还在。

所以 `set -euo pipefail` 不触发，`pgrep` 也找得到——一个永远在等的进程和一个正在收日志的进程，
从外面看长得一模一样。

## 解法

WiFi 连接下不要用 `idevicesyslog` 判活，也别指望它留下日志。

判活改看 `--console` 那份日志：`devicectl device process launch --console` 的输出是 app 自己的
stdout/stderr，走的是另一条通道，WiFi 下正常出数。判据换成那个文件的 mtime 或最后一行。

`scripts/ios-dictation/` 里 `turn-run.sh`、`turn-replay-run.sh`、`speech-run.sh` 三个脚本的判活循环
现在读的都是 `$RUNLOG.app.log`，WiFi 下全部是假的。

顺带：崩溃报告也拿不到，要看崩溃就得让设备插上线，或者靠 `--console` 里的
`App terminated due to signal 6` 这类行。

判「日志通道活着没有」的正确办法是看文件有没有在长，不是看进程在不在。坑 163 说的是同一个方向：
`pgrep` 找得到不等于它在干活。
