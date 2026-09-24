# 401 云签名不会替 App ID 打开 capability

## 现象

entitlements 里加了 `com.apple.developer.healthkit` 之后，Mac 上用 App Store Connect key 做云签名（`tauri ios build --export-method debugging`，bundle id `com.xinyuan.readingpartner.dev`），archive 成功、二进制已链接 HealthKit、archive 里的签名也带着这个 entitlement，export 阶段失败：

```
error: exportArchive Automatic signing cannot update bundle identifier "com.xinyuan.readingpartner.dev".
error: exportArchive Provisioning profile "iOS Team Provisioning Profile: com.xinyuan.readingpartner.dev" doesn't include the HealthKit capability.
```

## 原因

`-allowProvisioningUpdates` 加 API key 能现建证书和 profile（坑 197），但不改 App ID 本身。profile 只能带 App ID 上已经打开的 capability，App ID 上没有 HealthKit，就生成不出带它的 profile。

## 解法

先在 App ID 上打开 capability，再构建。两种做法任选：

- developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → 选 bundle id → Capabilities 勾 HealthKit（子选项都不勾）→ Save。
- API：`GET /v1/bundleIds?filter[identifier]=<bundle id>` 取资源 id，再 `POST /v1/bundleIdCapabilities`，body `{"data":{"type":"bundleIdCapabilities","attributes":{"capabilityType":"HEALTHKIT"},"relationships":{"bundleId":{"data":{"type":"bundleIds","id":"<资源 id>"}}}}}`。

正式包名和 `.dev` 包名是两个 App ID，要各开一次。新增任何需要 capability 的 entitlement 都照此办理。
