# 566 SSH 里 `simctl bootstatus -b` 永不返回，无头 boot 的模拟器截不了图

## 现象

在 Mac mini 上经 SSH 跑 `scripts/ios-sim.sh up`，卡在 `xcrun simctl bootstatus <udid> -b`，一直不返回。改成只 `xcrun simctl boot <udid>` 能启动，但截图报 `no default display port`。

## 原因

SSH 会话不在图形登录会话里，`simctl boot` 起来的是没有显示端口的无头设备，`bootstatus -b` 等的状态在这种设备上不会到达。

## 解法

boot 之后把 Simulator.app 挂进图形会话（和坑 179、180 同一套）：

```
xcrun simctl boot <udid>
sudo -A launchctl asuser 501 sudo -u <user> open -a Simulator --args -CurrentDeviceUDID <udid>
```

等一分钟再截图。不调 `bootstatus -b`；要等 app 起来，就轮询 `scripts/ios-sim.sh eval "location.href"` 直到 `tauri://localhost`。
