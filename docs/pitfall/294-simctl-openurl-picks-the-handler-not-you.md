# `simctl openurl` 投 `file://` 到不了自己的 app

## 现象

要在模拟器上验「分享一本书进 app」，最直接的想法是照 iOS 的真实做法来：把文档拷进 app 沙盒的 `Documents/Inbox/`，再 `xcrun simctl openurl <udid> "file:///.../x.pdf"`。命令返回 0，app 一动不动——没启动，`Documents` 下没有新拷贝，`topics.json` 没变。屏幕上是系统的「预览」打开了这个 PDF；EPUB 同理。

把 `.app/Info.plist` 里两条 `CFBundleDocumentTypes` 的 `LSHandlerRank` 从 `Alternate` 改成 `Owner`、重签名、重装，仍然是「预览」赢。`com.apple.Preview` / `com.apple.PreviewShell` 是系统 app，`simctl uninstall` 拒绝卸载。

## 原因

`simctl openurl` 不是「投给某个 app」，是「交给 LaunchServices 按 UTI 挑一个 app」。`com.adobe.pdf` 和 `org.idpf.epub-container` 在 iOS 26 的模拟器上归「预览」，第三方 app 抢不过它。真机上用户是在分享面板里自己点的，那一步 LaunchServices 不参与——所以 `openurl` 复现的根本不是同一条路。

（`file://` 指向 app 自己容器内、且 app 正在前台时，EPUB 有时会落到自己 app 上，但这个行为不稳定，不能当判据。）

## 解法

驱动真的分享面板，用 XCUITest。`scripts/ios-sim/GestureDriver` 那个 UI 测试包不需要宿主 app，按 bundle id 附着到任何已安装的 app 上，照抄一份就能驱动 Safari：

1. Mac 上起个 http server 发这本书，`simctl openurl <udid> "http://localhost:<port>/x.pdf"`，Safari 内联显示 PDF。
2. XCUITest 附着 `com.apple.mobilesafari`，`window.coordinate(withNormalizedOffset:)` 点右上角分享按钮。
3. 在 app 和 `com.apple.springboard` 两棵树里按 `label CONTAINS "Reading Partner"` 找那个 `identifier: 'shareCell'` 的格子，点它。

这条走的是 `application:openURL:` 的真链路：iOS 把文件拷进 `Documents/Inbox/`（重名会变成 `x-1.pdf`），app 冷启动或被唤到前台。验冷启动就在第 3 步之前确认 app 没在跑（`simctl terminate` 回 `found nothing to terminate`）。

EPUB 在 Safari 里是下载而不是内联，分享面板拿不到；EPUB 那半改用 `openurl` 投容器内的 `file://`（上面那个不稳定行为），或另找一个能分享 EPUB 的宿主。

`idb` 装不装都不影响：XCUITest 的点击不走 idb 的 HID 通道。
