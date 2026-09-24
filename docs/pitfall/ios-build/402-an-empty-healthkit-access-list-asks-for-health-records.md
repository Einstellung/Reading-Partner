# 402 空的 healthkit.access 也算申请临床健康记录

## 现象

照 Xcode 勾 HealthKit 时写出的样子，entitlements 里放了 `com.apple.developer.healthkit = true` 和空数组 `com.apple.developer.healthkit.access`。云签名 export 时多报一条：

```
Provisioning profile "..." doesn't include the HealthKit Access (Verifiable Health Records) capability. HealthKit Access (Verifiable Health Records) capability needs to be assigned to your team and bundle identifier by Apple in order to be included in a profile.
```

## 原因

签名流程只看这个 key 在不在，不看数组空不空。它对应的是要 Apple 单独批给团队的 Verifiable Health Records capability，普通 profile 永远带不上。

## 解法

只读身高体重这类数据时只写 `com.apple.developer.healthkit`，不写 `.access`。`plugins/health/build.rs` 和 `scripts/ios-entitlements.ts` 都照此。
