# 567 每次重装 .dev 都要重新给本地网络权限，不给就连不上 dev server

## 现象

真机上的 .dev 包（Tauri dev 模式，devUrl 指向 Linux 的 `http://10.42.0.1:1437`）启动后整页只有一句 `Failed to request http://10.42.0.1:1437/: error sending request ... did you grant local network permissions?`。Linux 上用 `ss` 采样，1437/1438 上一条连接都没有。DVT 截图能看到上面盖着系统弹窗「Allow "Reading Partner" to find devices on local networks?」。点 Allow 后重启 app，页面就加载出来，连接都来自设备的地址。设备和 Linux 同在一个网段、ping 得通也照样被挡。

## 原因

iOS 的本地网络权限跟着安装走，卸载重装或用新 ipa 覆盖安装后都要重新授权。授权前 app 发往局域网地址的请求在设备上就被拦下，包根本没发出来。

## 解法

每次装完新 .dev 包，先 `dvt launch`，再 `dvt screenshot` 看有没有这个弹窗。有就让用户点 Allow，然后重启 app。报错页上那句「local network permissions」要当真：先去设备上找弹窗，不要急着查 ufw 和路由。国行 iPhone 还另有「无线数据」权限，见坑 217。
