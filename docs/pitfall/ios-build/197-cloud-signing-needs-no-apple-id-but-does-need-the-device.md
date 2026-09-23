# 197 云签名不需要 Xcode 里有 Apple ID，但设备得自己注册

## 现象

Mac 构建机的 Xcode 里一个 Apple ID 都没有（`DVTDeveloperAccountManagerAppleIDLists` 的 `IDE.Identifiers.Prod` 是空数组），钥匙串里只有一张 Personal Team 的证书，付费团队 HF6369DDYP 名下证书 0 张、profile 0 个。这种状态下 `bun run tauri ios build --debug --target aarch64 --export-method debugging` 照样出了一个能装真机的包：

- 签名身份 `Apple Development: Created via API (YD4J8V6NDW)`
- 描述文件 `iOS Team Provisioning Profile: com.xinyuan.readingpartner`，TeamIdentifier `HF6369DDYP`，`get-task-allow = true`，有效期一年（不是 Personal Team 的 7 天）
- `ProvisionedDevices` 里就是目标手机的 UDID

两样东西都是 export 阶段现建的，建完就出现在 `/v1/certificates` 和 `/v1/profiles` 里。

但设备不是。`POST /v1/devices` 之前，同一条命令 export 阶段会因为团队里没有可用设备而给不出 Development profile。

## 原因

Tauri 的 macOS CLI 看到 `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH` 三个环境变量齐了，就把 `-allowProvisioningUpdates` 和三个 `-authenticationKey*` 透传给 `xcodebuild`；xcodebuild 拿这把 App Store Connect key 直接在门户上建证书和 profile，走的是 key 的权限，不走 Xcode 的登录账号。`APPLE_DEVELOPMENT_TEAM` 覆盖团队。

它不传 `-allowProvisioningDeviceRegistration`（macOS 二进制里 0 处），所以注册设备这一步没人替你做。Development profile 必须列出设备 UDID，团队里没有设备就没有 profile。

## 解法

先注册设备，再构建。注册是一次写请求：

```
POST /v1/devices
{"data":{"type":"devices","attributes":{"name":"…","platform":"IOS","udid":"…"}}}
```

回 201，`status` 先是 `PROCESSING`。这会占掉团队每年 100 个 iOS 设备名额里的一个，当年之内只能禁用不能真删，所以一次注册对，别反复试。

.p8 放构建机的 `~/.appstoreconnect/private_keys/`（`chmod 600`），三个变量写进一个 `chmod 600` 的 env 文件，构建时 source 进来。同一把 key 建 Development 证书回 201、建 Distribution 回 403（坑 47），这条路只走开发签名。

日志里 `found cert "Apple Distribution: Tauri (unset)"` 和 archive 阶段的 `No code signing certificates found` 都是噪音（坑 48），看 export 阶段的 `Exported reading-partner_iOS to:` 才算数。
