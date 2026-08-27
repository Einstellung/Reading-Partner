# `launchctl asuser` 只换 security session，进程还是 root

现象：坑 [179](./179-ssh-session-codesign-has-no-keychain.md) 的 codesign 错消失了，换成另一对：

```
error: No Accounts: Add a new account in Accounts settings.
error: No profiles for 'com.xinyuan.readingpartner.dev' were found
```

跑的是 `sudo launchctl asuser 501 /bin/bash -c '...'`。同时 `Build description path` 落在 `/var/root/Library/Developer/Xcode/DerivedData/...`。

原因：`asuser` 只把进程放进目标用户的 security session，进程身份还是 root，Xcode 读的是 root 的账号和 DerivedData。

解法：内层再套一次 `sudo -u <user>`，完整形式 `sudo launchctl asuser 501 sudo -u mima1234 <命令>`。两层缺一不可：外层给 session（坑 [179](./179-ssh-session-codesign-has-no-keychain.md) 要的），内层给身份。
