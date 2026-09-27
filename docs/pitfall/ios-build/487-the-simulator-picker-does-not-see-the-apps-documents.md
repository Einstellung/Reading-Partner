# 模拟器的文件选择器看不见 app 自己的 Documents

## 现象

要在模拟器上验「从文件选择器挑一本书」（加书、「Replace with a new version…」），把书拷进 app 沙盒的 `Documents/`，选择器里点「我的 iPad」是空的。拷进去之后才打开的选择器也一样。

把书放对了地方之后，一个已经开着的选择器停在「我的 iPad」也不会自己列出来。

## 原因

「我的 iPad」列的是本机 File Provider 的存储，不是各 app 的 `Documents`。app 的 `Documents` 只有在 Info.plist 声明了 `UIFileSharingEnabled` 和 `LSSupportsOpeningDocumentsInPlace` 时才挂进去，本 app 两个都没声明。

这块存储在模拟器上是一个 App Group 容器：`data/Containers/Shared/AppGroup/<uuid>/File Provider Storage/`，`<uuid>` 每台模拟器不同，认它要看目录里 `.com.apple.mobile_container_manager.metadata.plist` 的 `MCMMetadataIdentifier` 是不是 `group.com.apple.FileProvider.LocalStorage`。从外面拷进去的文件不会通知选择器，它显示的是打开那一刻的列表。

## 解法

```sh
D=~/Library/Developer/CoreSimulator/Devices/$UDID/data/Containers/Shared/AppGroup
for g in "$D"/*; do
  plutil -p "$g/.com.apple.mobile_container_manager.metadata.plist" 2>/dev/null \
    | grep -q FileProvider.LocalStorage && cp book.epub "$g/File Provider Storage/"
done
```

选择器里先点别的位置（「iCloud 云盘」）再点回「我的 iPad」，文件就出来了。
