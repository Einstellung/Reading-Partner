# 562 装包挂盘后第一次起 WDA 固定 60 秒失败，第二次就好

## 现象

Linux 上用 pymobiledevice3 起 WebDriverAgent：刚装完 runner、刚挂完开发者磁盘镜像，第一次 `pymobiledevice3 developer dvt xcuitest com.xinyuan.wda.xctrunner --userspace` 正好 60 秒后报 `initializationForUITestingDidFailWithError`，日志里的 NSError 只有对象名，看不到 domain 和 code。紧接着再起一次，10 秒内 `/status` 就 ready，之后几次 2.4 秒。

## 原因

未定位。pymobiledevice3 10.3.0 的 `NSError` 没有像样的 repr，错误内容被吞掉；要看内容得给 `pymobiledevice3.dtx.ns_types.NSError.__repr__` 打补丁再跑。观察到的规律只有"装包或挂盘后的第一次"。

## 解法

第一次失败时保持设备解锁，原样再起一次；失败分支先 `wda-stop`（坑 563）再退出。别把它当成签名或 profile 的问题去查。
