# `gen/apple` 只能经 tauri CLI 构建，且要先清上一次的残留

现象：用裸 `xcodebuild` 编 `gen/apple`，死在 "Build Rust Code" 阶段：

```
failed to read CLI options ... Connection refused
```

随后 SIGABRT。换成 tauri CLI 后重复跑，第二次又失败：

```
failed to rename app .../reading-partner_iOS.xcarchive/Products/Applications/Reading Partner.app: Directory not empty (os error 66)
```

原因：Xcode 工程里的 "Build Rust Code" 阶段跑的是 `tauri ios xcode-script`，它要连一个 JSON-RPC WebSocket，而那个服务只在 `tauri ios build` / `tauri ios dev` 运行期间由 tauri CLI 提供。第二个错是上一次构建留下的 xcarchive 还在原地。

解法：验编译用 `bun run tauri ios build --debug --ci --target aarch64-sim --no-sign`，这条不需要任何签名身份。构建前先 `rm -rf src-tauri/gen/apple/build`。

日志里 swift-rs 的临时目录在 iOS 构建里也叫 `arm64-apple-macosx`：它传的是 `-Xswiftc -target` 而不是 `--triple`，纯命名产物，不是平台搞错了。
