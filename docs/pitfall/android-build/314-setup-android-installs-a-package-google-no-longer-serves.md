# setup-android 默认装的 `tools` 包 Google 已不再提供

## 现象

v0.19.1 打 tag 后桌面三端和 TestFlight 都过了，Android 那个 job 在 `android-actions/setup-android@v4` 这一步退出 1，重跑同样。日志末尾是 `sdkmanager tools` → `Warning: Failed to find package 'tools'`，我们自己的步骤一步没跑到。前一天 v0.19.0 同一份 workflow 是绿的。

## 原因

这个 action 的 `packages` 输入默认值是 `tools platform-tools`，`tools` 是 Android SDK 早已废弃的旧包，2026-09-15 起 Google 的仓库索引里没有它了，sdkmanager 找不到就非零退出，action 把它当致命错误。和我们的代码、runner 镜像、NDK 版本都无关。

## 解法

`with: packages: platform-tools`，只要 platform-tools；NDK、build-tools、platforms 本来就由下一步自己 `sdkmanager` 装。`android-apk.yml` 和 `android-engine-smoke.yml` 都改。顺带给 `android-apk.yml` 的 `workflow_dispatch` 加了 `release_tag` 输入，这样 tag 触发的 run 挂了可以从 main 手动补一发 APK 挂到同一个 release 上，不用重打 tag。
