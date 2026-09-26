# 移动端平台缺口

## 愿景

Android 落地（[23](../platform/23-Android落地调研.md)）和 iOS 侧载（[19](../platform/19-iOS侧载安装.md)）都定过方案，本文收的是零散但没人接手的平台层缺口：识别、语音权限、安全区、真机验证链，加上三平台发版并发写 `latest.json` 的竞态。

## 为什么现在不做

iOS 是当前目标平台，Android 还停在「落地调研」，没有真实用户在等。iOS 真签名 + OTA 分发依赖账号持有人的网页操作（同桌面自动更新的证书申请）。`latest.json` 的竞态今天靠人工核对七个键顶着，量没到出问题的地步。

## 将来做时已知的事实

- `isAndroid()` / `isMobileOS()` 没有：`src/ui/components/settings/OAuthCard.tsx:54` 仍用 `isIOS()` 分支，Android 会走 iOS 那套 OAuth 文案和流程。`src/platform/app/platform.ts` 今天只有 `isMobilePlatform()` 和 `isIOS()`。
- Android manifest 缺 `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`，语音在 Android 上完全没接：`src-tauri/src/lib.rs` 里语音相关代码整段 `#[cfg(desktop)]`，Android 目标编译时被裁掉。
- Android 安全区（刘海、手势条）没有从 `WindowInsetsCompat` 读出来喂给 CSS 变量，今天没有对应实现。
- 整条 APK 链（模拟器装真 app 截图、真机、tag 触发发布）没有验证过，只有 smoke 包的 `screencap`。
- iOS 真签名 + OTA 分发（itms-services manifest 挂 GitHub Releases）没做。[19](../platform/19-iOS侧载安装.md) §5.5。
- 发版时 `latest.json` 由三个平台的 job 并发读改写，没有防护，可能丢键，今天靠人工核对七个键。[76](../platform/76-桌面自动更新.md)。

## 待定

Android 什么时候从「调研」转成「落地」，没有触发条件。
