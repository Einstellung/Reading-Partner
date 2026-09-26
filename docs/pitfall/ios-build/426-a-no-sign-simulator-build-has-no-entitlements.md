# 426 `--no-sign` 的模拟器包没有 entitlements，App Group 拿不到容器

## 现象

真 app 加了 share extension 和 App Group，按坑 183 的配方 `tauri ios build --ci --debug --target aarch64-sim --no-sign` 出包、装进模拟器。Safari 分享进扩展，表单正常弹出，点 Send 报：

```
Error Domain=ShareInbox Code=1 "no App Group container for group.com.xinyuan.readingpartner.dev"
```

`containerURL(forSecurityApplicationGroupIdentifier:)` 返回 nil，`simctl get_app_container <id> groups` 也列不出这个 group。同一份 Swift 在独立的 XcodeGen 小工程里（`CODE_SIGN_IDENTITY: "-"`、不设 team、没有 profile）一次就通。

## 原因

模拟器不查 profile，只看二进制里的 `__TEXT,__entitlements` 段，这个段是签名步骤写进去的。`--no-sign` 让 xcodebuild 整个跳过签名，段就没有了。`codesign -d --entitlements -` 对模拟器包无论有没有都只打出空 `<dict>`，拿它判断会误以为是 entitlements 文件没写对。

## 解法

模拟器上要验 App Group、keychain group 之类靠 entitlement 的东西时，去掉 `--no-sign`。模拟器签名是 ad hoc（`Signature=adhoc`），不碰钥匙串，SSH 里也能跑。只验编译时 `--no-sign` 照旧可用。

核对看段本身：`strings -a "<App>.app/<可执行文件>" | grep -A2 application-groups`，或 `otool -l <二进制> | grep __entitlements`。
