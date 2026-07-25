# tauri ios build 日志里两条像签名配置坏了的输出，其实是 Tauri 自己的噪音

现象：一是团队 ID 的警告，`APPLE_DEVELOPMENT_TEAM` 明明已经设了也照样出现：

```
Warn No code signing certificates found. You must add one and set the certificate
     development team ID on the `bundle > iOS > developmentTeam` config value or
     the `APPLE_DEVELOPMENT_TEAM` environment variable.
```

二是一张团队叫 `unset` 的分发证书，还真拿它签了包：

```
1 identity imported.
found cert "Apple Distribution: Tauri (unset)" with organization "Tauri"
Signing with identity "Apple Distribution: Tauri (unset)"
```

原因：第一条来自 Xcode 构建阶段里跑的 `tauri ios xcode-script`。Xcode 的 script phase 只拿到 build settings 那一套环境，不继承 job 级 env，那个子进程确实读不到 `APPLE_DEVELOPMENT_TEAM`；父进程 `tauri ios build` 读到了，日志里能看到 `export DEVELOPMENT_TEAM=...` 已经写进了 build settings。第二条是设计内的临时占位：`APPLE_API_KEY`、`APPLE_API_ISSUER`、`APPLE_API_KEY_PATH` 三个都设上时，tauri-cli 判定走云签名，build 和 archive 两步都传 `CODE_SIGNING_ALLOWED=NO` 产出无签名 archive，接着它现生成一张自签证书（`person_name: "Tauri"`、`team_id: "unset"`，所以 CN 是 `Apple Distribution: Tauri (unset)`）导进临时 keychain，用它给二进制盖一遍 entitlements——无签名的包直接 export 会丢 entitlements——最后交给 `xcodebuild -exportArchive` 用真证书重签。`1 identity imported.` 和那段 keychain 属性 dump 就是这一步 `security import` 的输出。都在 tauri-cli 的 `crates/tauri-cli/src/mobile/ios/build.rs` 里。

解法：两条都忽略。签名到底成没成看 export 阶段的输出，不看这两行。
