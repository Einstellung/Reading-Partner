# 613 .dev 应用的进程还活着时，`apps install` 卡在 0% 不返回

## 现象

`pymobiledevice3 apps install` 装 .dev 包（`com.xinyuan.readingpartner.dev`），输出停在 `bundle id: com.xinyuan.readingpartner.dev` 之后，进度一直是 0%，不报错也不结束。设备上 .dev 应用的进程在跑时必现，跑过语音 bench 的那个进程之后尤其明显；一天里连续五次。重新插拔 USB 不能稳定解决，`lsusb` 里设备号没变，插拔可能没有真的重置连接。

## 原因

未确认。只观察到进程活着时卡、进程杀掉后装得上，推测是运行中的应用挡住了 installation_proxy。

## 解法

装之前先把设备上的 .dev 进程杀掉：

```
pymobiledevice3 developer dvt proclist --userspace --udid "$U" | grep -i readingpartner
pymobiledevice3 developer dvt kill --userspace --udid "$U" <pid>
```

再 `scripts/ios-linux/device.sh install ...`。只杀 .dev 的 pid，不要杀 TestFlight 版（`com.xinyuan.readingpartner`）。
