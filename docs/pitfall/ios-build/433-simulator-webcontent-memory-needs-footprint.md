# 433 模拟器里量 WebContent 内存：launchctl 找不到它，RSS 不能用

## 现象

想量 app 的 WKWebView 占多少内存。`xcrun simctl spawn <udid> launchctl list | grep WebContent` 一行都没有。换成宿主 `ps` 找到进程后读 RSS，同一个进程、同一个页面几分钟内在 73 MB 和 332 MB 之间跳，前后两次测量的差比要比的东西大一个量级。

## 原因

模拟器里的 WebContent 是宿主上的普通进程，父进程是这台设备的 `launchd_sim`，不登记在设备的 launchctl 列表里。RSS 算的是驻留页，宿主 macOS 随时换出和共享映射都会让它大幅波动，和 iOS 上 jetsam 看的 `phys_footprint` 不是一个量。

## 解法

按父进程找，用 `footprint` 读：

```
LP=$(pgrep -f "launchd_sim.*$UDID" | head -1)
P=$(ps -ax -o rss=,ppid=,pid=,comm= | awk -v p=$LP '$2==p && /WebContent/ {print $1, $3}' | sort -n | tail -1 | awk '{print $2}')
footprint $P | grep phys_footprint
```

同一页面反复读 `phys_footprint` 稳在几 MB 以内。它仍是模拟器的数，真机的上限和回收时机要在真机上复核；比较两种做法时在同一次会话里先读一次空页面当基线，只看差值。
