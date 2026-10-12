# 563 杀掉本地 xcuitest 进程，设备上的 WDA runner 还在跑

## 现象

`pymobiledevice3 developer dvt xcuitest ...` 在后台起 WDA，收尾时 kill 掉这个本地进程和 `usbmux forward`。设备上 WebDriverAgentRunner 仍在运行，下次 `wda-start` 和设备上的旧实例撞在一起。

## 原因

runner 是设备上 testmanagerd 拉起的进程，本地那条 DTX 连接断开不会让它退出。

## 解法

停的时候连设备上的一起停：

```
PID=$(pymobiledevice3 developer dvt process-id-for-bundle-id --userspace --udid "$U" com.xinyuan.wda.xctrunner | tail -1)
pymobiledevice3 developer dvt kill --userspace --udid "$U" "$PID"
```

再 kill 本地记下 PID 的 forward 和 xcuitest。`scripts/ios-linux/device.sh wda-stop` 就是这个顺序。
