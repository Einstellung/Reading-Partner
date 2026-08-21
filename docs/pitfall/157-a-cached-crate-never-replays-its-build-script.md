# 依赖命中缓存就不跑 build script，它写进生成目录的东西一起没了

## 现象

0.9.2 build 48（run 31863361942）和 0.10.1 build 53（run 32355962545）的 TestFlight 包里没有 `CFBundleURLTypes`。iOS 上 Google 授权完，Safari 跳自定义 scheme 报「网址无效」，回调永远回不到 app，登录静默断掉。同一条流水线的 0.8.6 build 24（run 30746368253）产物里这个键是在的。构建绿、上传绿、分发绿，没有一步报错。

## 原因

写这个键的唯一一处是 `tauri-plugin-deep-link` 的 build.rs（`tauri_plugin::mobile::update_info_plist`），它把 `tauri.conf.json` 里 `plugins.deep-link.mobile[].scheme` 写进 `src-tauri/gen/apple/<app>_iOS/Info.plist`。这是 cargo build script 的副作用：落点在生成目录里的一个文件，不是 cargo 自己的编译产物。

两件事撞在一起。workflow 用 `Swatinem/rust-cache` 缓存 `src-tauri` 的 target，依赖 crate 命中缓存就不重新编译，build script 也就不再执行——缓存回放的是编译产物，副作用没人回放。而 `gen/apple` 不入库，每次 `tauri ios init --ci` 现生成一份干净模板。于是上次写过的那个文件和这次要打包的那个文件根本不是同一个，新的那份没人去写那个键。CI 日志里的判据：只有 `Compiling reading-partner`，没有任何依赖 crate 在编译。

Android 那条线不受影响，同一份 build.rs 的 manifest 分支在那次构建里跑到了。

## 解法

- 别让产物依赖 build script 的副作用。两条 iOS 流水线在 `tauri ios init --ci` 之后、`tauri ios build` 之前跑 `bun scripts/ios-deep-link-plist.ts inject`，从 `tauri.conf.json` 读同一份 scheme 写进生成的 Info.plist。注入幂等：先把已有的 `CFBundleURLTypes` 整段删掉再写，冷缓存下 build script 真跑了也不会留下两份。
- 断言要落在产物上，不落在自己刚写完的文件上。`bun scripts/ios-deep-link-plist.ts verify <ipa>` 从 ipa 里取 `Payload/*.app/Info.plist`（Xcode 会把它编成 binary plist，`PlistBuddy` 之外的工具要能吃二进制），缺任何一条 scheme 就 exit 1。TestFlight 线在上传前跑，侧载线在校验步骤里跑。
- 通用判据：一个构建步骤往生成目录里写东西，就得问它会不会因为缓存而不跑；只要那个目录还会被重建，就自己写一遍，并在最终产物上验一遍。
