# 单独 cargo check 插件的 iOS target，Swift 会按 iOS 13 编译，报一堆和改动无关的可用性错

## 现象

只想验 `plugins/voice/src/ios.rs` 那条 Swift 桥编得过，不想跑一整轮
`tauri ios build`（要签名，账号掉了就走不下去）：

```sh
cd plugins/voice && cargo check --target aarch64-apple-ios
```

build script 直接 panic，往上翻是 Swift 的可用性错误，全在这次没动过的文件里：

```
error: 'requestRecordPermission(completionHandler:)' is only available in iOS 17.0 or newer
note: add 'if #available' version check
thread 'main' panicked at swift-rs-1.0.8/src-rs/build.rs:350:17:
Failed to compile swift package tauri-plugin-voice
```

## 原因

`tauri_plugin::Builder::ios_path()` 让 build script 用 swift-rs 编那个 SPM 包，
swift-rs 自己拼 `-target arm64-apple-ios<版本>`，版本取环境变量
`IPHONEOS_DEPLOYMENT_TARGET`，没有就用它内置的老下限。`Package.swift` 里
`platforms: [.iOS("26.0")]` 它不读——那是 SwiftPM 的字段，swift-rs 不走 SwiftPM
的 manifest 解析。

平时不撞是因为 `tauri ios build` 由 Xcode 工程设置 `IPHONEOS_DEPLOYMENT_TARGET`，
swift-rs 就跟着对了。

## 解法

```sh
IPHONEOS_DEPLOYMENT_TARGET=26.0 cargo check --target aarch64-apple-ios
```

Swift 那半单独验用 xcodebuild 直接编这个包，它会按 `Package.swift` 的下限来，
也不需要签名：

```sh
cd plugins/voice/ios
xcodebuild -scheme tauri-plugin-voice -sdk iphoneos \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/rp-voice-dd \
  CODE_SIGNING_ALLOWED=NO build
```

两条合起来就是"没有签名也能验两边都编得过"，比整轮 iOS 打包快一个数量级。
