# 427 把 cargo target 目录拷到另一个检出里复用，swift-rs 编译失败

## 现象

Mac 上新开一个检出目录做 iOS 模拟器构建，为了省冷编译，把老检出的 `src-tauri/target/aarch64-apple-ios-sim` 用 `cp -cR` 克隆过来。`tauri ios build` 在 `cargo build` 阶段 panic，位置是 `swift-rs-1.0.7/src-rs/build.rs:281`（经 `tauri-utils::build::link_apple_library` 调到）：

```
error: precompiled file '<新路径>/.../out/swift-rs/Tauri/.../ModuleCache/.../SwiftShims-....pcm' was compiled with module cache path '<老路径>/.../ModuleCache/...', but the path is currently '<新路径>/...'
error: missing required module 'SwiftShims'
```

## 原因

swift-rs 在各 crate 的 `out/swift-rs/` 下跑 `swift build`，clang 的预编译模块（`.pcm`）把 module cache 的绝对路径写死在文件里。cargo 在新路径下重跑某个 build script 时，Swift 编译器读到路径对不上的 `.pcm`，直接拒绝。

## 解法

拷完先删掉所有 swift-rs 的输出目录，其余 Rust 产物照样复用：

```
find src-tauri/target/aarch64-apple-ios-sim -type d -name swift-rs -path '*/out/*' -prune -exec rm -rf {} +
```

这样做之后增量构建几分钟就过。
