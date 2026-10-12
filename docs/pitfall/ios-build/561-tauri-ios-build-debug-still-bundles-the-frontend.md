# 561 `tauri ios build --debug` 照样打包前端，不读 devUrl

## 现象

想在 CI 里出一个连 Linux 上 Vite 的 dev 模式包：`tauri ios build --debug --config '{"build":{"devUrl":"http://192.168.0.107:1437"}}'`。包装上去打开的是打包进去的前端，改源码不生效；二进制里找不到 devUrl 字符串，却有一串 `/assets/index-*` 引用。

## 原因

`tauri ios build` 不管带不带 `--debug`，编 Rust 时一律打开 `tauri/custom-protocol` feature，这个 feature 就是"用内嵌的 dist"。只有 `tauri ios dev` 编出来的是 `cfg(dev)`、读 devUrl。`--debug` 只管优化级别和导出方式。

## 解法

借 `tauri ios dev` 发布构建参数，自己跑 `xcodebuild`：

1. `tauri ios init --ci --config dev.json`，`dev.json` 里写 `identifier`（.dev 包名）、`beforeDevCommand: ""`、`devUrl`。
2. 后台起 `bun tauri ios dev --open --host <Linux 的 IP> --no-dev-server-wait --config dev.json`。没有设备时它把构建参数（dev: true，devUrl 改写成 `--host`）挂在本地 socket 上等着。
3. 它等着的时候跑 `xcodebuild archive -scheme reading-partner_iOS -configuration debug ...`，Xcode 的 "Build Rust Code" 阶段（`tauri ios xcode-script`）从那个 socket 取到 dev 参数。
4. 导出后断言：`strings` 里有 `http://<host>:<port>`，`/assets/index-` 出现 0 次（注意坑 564）。

完整步骤在 `exp/linux-ios-loop` 分支 `.github/workflows/ios-linux-loop.yml` 的 devbuild job，见 docs/platform/560。
