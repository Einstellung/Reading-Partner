# CI 云签名要 Admin 权限的 App Store Connect API key，App Manager 会在 export 阶段被拒

现象：`tauri ios build --export-method app-store-connect` 的 archive 阶段一路成功，export 阶段挂掉：

```
error: exportArchive Cloud signing permission error
** EXPORT FAILED **
error: exportArchive No profiles for 'com.xinyuan.readingpartner' were found
failed to export iOS app: command ["xcodebuild"] exited with code 70
```

此时 Apple 那边是干净的：0 张证书、0 个 profile、0 台设备。App ID 和 App 条目都建好了，`APPLE_TEAM_ID` 也确实传进了 job。用的 API key 是 Access 选 App Manager 生成的。

原因：云签名（`-allowProvisioningUpdates` 加 `-authenticationKey*`）在 export 阶段要现场建一张 cloud-managed 分发证书和一个 App Store profile，而 Apple 只让 **Admin** 权限的 key 碰 cloud-managed distribution certificate，App Manager 和 Developer 一律拒。第二行 "No profiles were found" 是第一行的后果，不是另一个问题。拿同一把 key 直接打 App Store Connect API 能把这条边界钉死：`POST /v1/certificates` 传 `certificateType: DISTRIBUTION` 或 `IOS_DISTRIBUTION` 都回 403 FORBIDDEN_ERROR，传 `DEVELOPMENT` 回 201。能建开发证书、不能建分发证书，卡的就是 key 的权限，不是账号没激活或协议没签。另外，试探权限时别用故意写坏的 payload：字段校验跑在鉴权前面，payload 不合法一律回 409 ENTITY_ERROR，跟有没有权限无关，据此会误判成「写权限没问题，问题在别处」。

解法：重新生成一把 Access 选 **Admin** 的 team key，换掉 `APPLE_API_KEY_ID` 和 `APPLE_API_KEY_P8_BASE64` 两个 secret。Issuer ID 是团队级的，`APPLE_API_ISSUER` 不动；workflow 一行不用改。key 生成后 name 和 access 都改不了，选错只能撤销重建。换成 Admin key 仍报同样的错，是 Apple 后端权限没同步（Apple Developer Forums thread 810658 有先例），只能找 Developer Support 处理。Tauri 另有一条不吃 Admin 权限的手工签名通道：`IOS_CERTIFICATE`、`IOS_CERTIFICATE_PASSWORD`、`IOS_MOBILE_PROVISION` 三个环境变量给到 .p12 和 .mobileprovision，tauri-cli 的 `signing_from_env` 读到就把 Xcode 工程和 ExportOptions 切成 manual 签名，代价是证书和 profile 每年手工换一次。
