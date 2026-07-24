# iOS 侧载包主屏图标是 Tauri 占位图 / 1024 带 alpha 被 App Store 拒

## 现象

真机侧载后，app 装得上，主屏要么显示 Tauri 默认 logo（不是我们的 robot logo），要么图标空白。上传 App Store 另会因 1024 图标含 alpha 通道被拒。

## 原因

`tauri ios init` 生成 iOS 工程时，`Assets.xcassets/AppIcon.appiconset` 是 tauri-cli 内置的一套模板，原样拷进 `gen/apple/<app>_iOS/`，用的是 Tauri 默认图标。它不读 `src-tauri/icons/ios/`，也不读 `tauri.conf.json` 的 `bundle.icon`。CI 只跑 `tauri ios init` 不跑 `tauri icon`，我们的 logo 从未进入 iOS 构建。

`tauri icon` 生成 iOS 图标时会把源图透明背景合成到不透明底色，但始终以 RGBA 写出（含 1024 的 `AppIcon-512@2x.png`），alpha 通道永远在。alpha 不影响主屏显示（不透明 RGBA 照样显示），只卡 App Store 上传校验。

主屏空白与 alpha 无关，根因是 SpringBoard 靠 `Info.plist` 的 `CFBundleIconName` 到 `Assets.car` 里找图标；这个键要 actool 把 appiconset 认作 target 的 app icon 才会注入，缺了就空白。

## 解法

图标源：`src-tauri/icons/ios/*.png` 提交为一套无 alpha 的 RGB 图（`tauri icon` 生成后统一 strip alpha，18 张全 RGB，文件名与 tauri 模板的 `Contents.json` 一一对应）。

两条 iOS workflow 在 `tauri ios init` 之后加一步，把这套图覆盖到生成工程的 appiconset：

```
DEST=$(find src-tauri/gen/apple -type d -name AppIcon.appiconset -print -quit)
cp src-tauri/icons/ios/*.png "$DEST"/
```

文件名一致，所以模板的 `Contents.json` 不动照样解析，actool 编出的是我们的 logo。

`src-tauri/Info.ios.plist` 显式设 `CFBundleIconName = AppIcon` 兜底，保证主屏能解析到图标，不依赖 actool 是否注入。sideload workflow 的 verify 步断言 `Assets.car` 存在、`CFBundleIconName=AppIcon`、bundle 里有 `AppIcon*.png`。

重新生成图标：本地 `tauri icon src-tauri/icons/source/icon-source-1024.png`，再对 `src-tauri/icons/ios/` strip alpha（RGBA→RGB 合成到白底，视觉无损因为已经不透明），提交。桌面/安卓图标不受影响（它们走 `icon.icns`/`icon.ico`/android 子目录，不碰 ios 子目录）。
