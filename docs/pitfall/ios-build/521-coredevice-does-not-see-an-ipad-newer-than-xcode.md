# 521 iOS 比 Xcode 新时 CoreDevice 看不到设备，lockdown 照样通

## 现象

iPad（iOS 26.7.1）插在 Mac mini（Xcode 26.6）上，`xcrun devicectl list devices` 只有一行没名字的 `unavailable`，详情里 `pairingState: unsupported`、`ddiServicesAvailable: false`；`devicectl manage pair` 报 `CoreDeviceService was unable to locate a service side device`（error 1011）。同一时刻 `idevicepair validate` 成功，`ideviceinfo` 读得出名字和版本，设备已信任、开发者模式已开。

## 原因

CoreDevice 认不出比本机 Xcode 支持的版本更新的系统，devicectl 的装机、启动、拷容器全走它；lockdown 和 RemoteXPC 不依赖 Xcode 的设备支持。

## 解法

不升 Xcode 也能做完真机验收，全走 pymobiledevice3（Mac 上 `uv venv` 装）：`apps install x.ipa` 装机，`apps afc <bundle id>` 读写容器，`developer dvt launch/kill/screenshot --userspace` 启动、按 PID 杀、截图（不用 root，不用 tunneld）。网页检查器用 Homebrew 的 `ios_webkit_debug_proxy -c <udid>:9222`。签名照旧，设备先在门户注册（坑 197）。
