# SSH 会话里 codesign 拿不到钥匙串，签名一律 errSecInternalComponent

现象：从 Linux `ssh` 进 Mac 跑 `tauri ios dev`，编译全过，最后一步 CodeSign 失败：

```
.../Reading Partner.app/Reading Partner.debug.dylib: errSecInternalComponent
Command CodeSign failed with a nonzero exit code
```

日志里 Signing Identity 和 Provisioning Profile 都正确解析出来了，只是签不动。

原因：SSH 会话有自己的 security session，拿不到图形登录会话里的钥匙串。手工解锁不解决：`security unlock-keychain -p <pw> ~/Library/Keychains/login.keychain-db` 和 `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <pw> ~/Library/Keychains/login.keychain-db` 两条都返回成功，codesign 照样 `errSecInternalComponent`。

解法：把命令放回图形会话跑，`sudo launchctl asuser <uid> sudo -u <user> <命令>`。只加外层的 `asuser` 不够，见坑 [180](./180-launchctl-asuser-still-runs-as-root.md)。
