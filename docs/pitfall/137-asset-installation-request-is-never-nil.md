# 模型装好了 `assetInstallationRequest` 照样返回非 nil

## 现象

`AssetInventory.assetInstallationRequest(supporting: [transcriber])` 的文档说
"nil 表示已安装"。真机上它每一次都返回一个非 nil 的 `AssetInstallationRequest`，
en-US 和 zh-CN 都一样，模型明明早就在设备上。

按"非 nil 就是要下载"写的代码于是每次按住说话都进下载分支，日志里每一轮都印一行
"downloading the model"。

## 原因

只是名字骗人。返回的 request 并不代表有东西要下载，`downloadAndInstall()` 对一个
已安装的 locale 是空操作：实测 4ms / 9ms / 38ms 返回，同一次运行里连续十几轮都是这个
数量级。真正的首次下载是分钟级的，两者差三个数量级。

## 解法

不要把"非 nil"当成"要下载"。该问还是每次都问——docs/33 记的系统会在长期不用后把模型
丢掉，所以不能缓存"已安装"——但别据此给用户看进度：

```swift
guard let request = request else { return }
// 非 nil 不等于要下载。已装的 locale 这里 4-40ms 返回，真下载是分钟级。
try await request.downloadAndInstall()
```

要区分只能靠计时，或者靠 `request.progress.fractionCompleted` 一开始就不是 1。首次
按住说话那一下的进度提示要按"可能几分钟、也可能瞬间"来设计，不能假定非 nil 就慢。
