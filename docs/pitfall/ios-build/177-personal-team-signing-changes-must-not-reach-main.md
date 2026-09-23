# 真机调试要用 Personal Team 签名，配套改动永远留在本地分支

## 现象

想在自己的 iPhone/iPad 上跑 `tauri ios dev` 做真机调试（不是走 TestFlight），一连撞上四件事：

1. 签名阶段被拒，`xcodebuild` 报 409 `The user can't have provisioning privilege.`，即便登录的账号本身就在付费开发者团队里。
2. 要测的功能（语音简报探针）用到 `SpeechAnalyzer`，只有 iOS 26 有、模拟器上也没有，必须把整个 app 的部署目标提到 26.0 才能真机装——但仓库里 `minimumSystemVersion` 是发布链路共用的一个字段。
3. `tauri ios dev` 起来后手机上一直转圈，网络请求全部失败，报 `error sending request for url`，而同一时刻 `curl` 能正常连到 Mac 上的 Vite dev server。
4. 探针要验证锁屏/切后台后录音和播放不中断，这需要声明后台能力，但这只是探针阶段的验证需求。

## 原因

1. 这个 Apple ID 在付费开发者团队里只有 Developer 角色，不是 Account Holder，而这个开发者账号本身注册的是个人（Individual）类型：个人账号的开发者门户是单人的，只有 Account Holder 能建证书和描述文件，团队成员能进 App Store Connect 管 TestFlight 和商店信息，但签名权限这个开关根本不允许打开（共享签名要 Organization 类型账号）。实测确认过这一条：这个成员登进 developer.apple.com，Account 页只有 Tools and resources / Profile / Emails / Agreements 四项加一个「Enroll today」，没有 Certificates, Identifiers & Profiles，Xcode 里也拉不到任何 team、建不出证书；用 Account Holder 的 App Store Connect API key 调 `GET /v1/users` 查到该成员的 `provisioningAllowed` 是 false，`PATCH /v1/users/{id}` 想把它改成 true，Apple 直接拒：`409 ENTITY_ERROR.ATTRIBUTE.INVALID`，消息 `The user can't have provisioning privilege.`。个人想在自己设备上调试，只能换成免费的 Personal Team 签名。`com.xinyuan.readingpartner` 这个 App ID 已经全局唯一地注册给了付费团队，Personal Team 抢不到同一个 identifier，必须换一个。
2. 部署目标是 `tauri.conf.json` 里全仓库共用的一个字段，改了它，TestFlight 的发布链路也跟着涨门槛——手上验证机型还没升级到 iOS 26 的话，下一个 TestFlight 版本会把它锁在门外。
3. `tauri ios dev` 让手机去连 Mac 在局域网地址上开的 Vite server，不是 localhost。iOS 14 起，app 访问局域网地址前系统要先弹一次用户同意，且只有 bundle 声明了 `NSLocalNetworkUsageDescription` 才会弹这个框；没声明就在请求出手机之前直接被拒，报错和网络故障长得一样。
4. `UIBackgroundModes: audio` 是发布级的能力声明，对应的是"这个功能已经上线"，探针阶段只是想知道锁屏后音频会不会被系统掐掉，还没有到写进发布声明的地步。

## 解法

这几件事全部堆在一条从不合并回 main 的分支上（这个仓库是 `ios-device-dev`），每个 commit message 里都写死「must not reach main」，防止后续合并把它们顺手带走：

- `tauri.conf.json` 的 `identifier` 加后缀 `.dev`（`com.xinyuan.readingpartner.dev`），给本地调试建一个 Personal Team 能接的新 App ID。两个代价照单全收，不试图绕开：Google 登录在 dev 包里失效（OAuth client 绑定 bundle id，回调 scheme 又要在构建期写死进 `tauri.conf.json`，改 identifier 而不同步改 scheme 必断，见坑 [31](./31-ios-deep-link-scheme-build-time.md)）；Tauri 按 identifier 派生每个 app 的数据目录，dev 包因此是一个和发布版互不相干的空数据目录。
- `minimumSystemVersion` 只在这条本地分支上先提到 26.0，主线不动；真要发布时这个字段跟着对应功能一起走一遍完整的合并决策，不因为调试期已经改过就顺势带上主线。
- `Info.ios.plist` 加 `NSLocalNetworkUsageDescription`，同样只留在本地分支：正式发布包从不连局域网（前端打进包里、走自定义协议加载），这个键没有"仅调试生效"的写法，声明了就是永久声明，所以不进 main。
- 探针阶段需要的 `UIBackgroundModes: audio` 也只加在这条分支上，等对应功能真正要发布再重新决定要不要写进主线的 `Info.ios.plist`。

一句话：signing identity、部署目标、局域网访问，只要是为"在自己手机上跑起来"服务的，就只活在本地分支里，不等它们被顺手合并；哪天对应功能真要发布，这些字段要不要改、改成什么值，跟着那次发布重新决策一遍。

主线后来因为注册听写插件（docs/15），独立地把 `minimumSystemVersion` 也提到了 26.0——那是另一条决策链，和这里的本地调试改动没有因果关系，只是巧合落在同一个值上。

和 docs/19（iOS 侧载安装）不是一回事：那份文档给的是没有开发者账号的人用免费 Apple ID 侧载安装，这里是账号本身在付费团队里、只是角色不够，为的是开发者自己的真机调试循环。
