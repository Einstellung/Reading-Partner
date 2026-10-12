# 562 起 WDA 时 iOS 26 要按 Touch ID 开 UI Automation，不按就 60 秒失败

## 现象

Linux 上用 pymobiledevice3 起 WebDriverAgent（`pymobiledevice3 developer dvt xcuitest com.xinyuan.wda.xctrunner --userspace`），正好 60 秒后报 `initializationForUITestingDidFailWithError`。给 NSError 打补丁后看到的内容是 `com.apple.dt.XCTest.XCTFuture 1000 "Timed out while enabling automation mode."`。此时设备屏幕上是系统弹窗「Touch ID for "XCTest" – Enable UI Automation」。按过指纹后再起，10 秒内 `/status` 就 ready，之后几次 2.4 秒。iPad 拔下 USB 再插回来后起 WDA，又弹了这个窗口。

## 原因

iPadOS 26 开启 UI Automation 前要本机生物识别确认，XCTest 在弹窗上等 60 秒，没人按就超时。之前看到的「装包或挂盘后第一次失败、第二次就好」，其实是那次有人在设备前按了指纹。pymobiledevice3 10.3.0 的 `NSError` 没有像样的 repr，错误内容默认被吞掉；要看内容得给 `pymobiledevice3.dtx.ns_types.NSError.__repr__` 打补丁。

## 解法

起 WDA 前先让人站在设备旁边，弹窗出来就按指纹。60 秒失败时先截一张 DVT 截图（`developer dvt screenshot`，不依赖 WDA），看是不是这个弹窗，别当成签名或 profile 的问题去查。失败分支先 `wda-stop`（坑 563）再退出。只看页面、不点按的验收用 `dvt launch` + `dvt screenshot` 就够了，不必起 WDA。
