# iOS 侧载安装（无 Apple 开发者账号）

给没有 Mac、没有 Apple 开发者账号的人，把 Reading Partner 装到自己 iPad 上。构建在 GitHub Actions 的 macOS runner 上出一个**未签名** ipa，签名在你自己的 Windows 电脑上用免费 Apple ID 现场做（Sideloadly）。全程零花费，代价是每 7 天要重签一次。

产线：`.github/workflows/ios-sideload-ipa.yml`。签名版走 App Store 的另说（`ios-testflight.yml`，要开发者账号）。

## 1. 从 Actions 下载 ipa

1. 打开仓库 Actions 页，选 workflow **iOS Sideload IPA**。
2. 取一次绿色的 run：手动点 **Run workflow**（跑在 main 上），或往 `ios-spike` 分支推一次触发。约 15-25 分钟。
3. run 页底部 **Artifacts** 里下载 `ios-sideload-ipa`，解压得到 `reading-partner-<版本>-ios-arm64-unsigned.ipa`。

这个 ipa 是未签名的，直接装不上，必须经下面的 Sideloadly 重签。

## 2. Windows 装 Sideloadly

Sideloadly 靠 Apple 的 USB 驱动和账户服务跟 iPad 通信，这些驱动在**官网版** iTunes / iCloud 里，Microsoft Store 版本没有，务必装官网版。

1. 装官网版 iTunes：apple.com/itunes，不要装 Microsoft Store 的。
2. 装官网版 iCloud：support.apple.com 的 iCloud for Windows（官网下载版，不是 Store 版）。
3. 装 Sideloadly：sideloadly.io，下载 Windows 版装好。
4. USB 线连 iPad，iPad 上弹「信任此电脑」点信任，输锁屏密码。

## 3. 用免费 Apple ID 签名并安装

建议专门注册一个小号 Apple ID 用于侧载，别用主账号（签名会往这个账号挂 App ID）。

1. 打开 Sideloadly，`IPA file` 处选第 1 步下载的 ipa。
2. `Apple ID` 填你的 Apple ID 邮箱。
3. 点 **Start**，弹窗输 Apple ID 密码。
   - 开了两步验证的账号，这里不是填短信验证码，而是要**应用专用密码**（App-Specific Password）：到 account.apple.com → 登录与安全 → 应用专用密码，生成一个，填进来。
4. Sideloadly 自动重签并推装。进度走完，iPad 桌面出现 Reading Partner 图标。

## 4. 信任证书 + 开开发者模式

装完先别急着点开，图标点开会报「不受信任的开发者」。

1. 信任证书：iPad 设置 → 通用 → VPN 与设备管理 → 在「开发者 App」下找到你的 Apple ID → 点「信任」。
2. 开开发者模式（iOS/iPadOS 16 及以上必须）：设置 → 隐私与安全性 → 开发者模式 → 打开 → 按提示重启 iPad → 重启后再确认一次。
   - 开发者模式这个开关，只有在装过一个开发签名的 app（也就是刚侧载完）之后才会出现；装之前找不到是正常的。
3. 现在点开 Reading Partner，正常启动。

## 5. 免费签名的限制（会咬到你的）

- **7 天过期**：免费 Apple ID 签出来的证书 7 天失效，到期 app 打不开，得用 Sideloadly 对着同一个 ipa 再 Start 一次重签（数据不丢）。Sideloadly 有后台自动重签：装的时候勾上，让 iPad 和电脑同一 Wi-Fi 或插着 USB，它会在到期前自动续。
- **最多 3 个**：一个免费 Apple ID 在一台设备上同时最多 3 个侧载 app。超了先删旧的。
- **需要电脑**：每次重签都要电脑跑 Sideloadly，纯 iPad 上无法自我续签。

## 6. 我们这个 app 在免费签名下的行为

免费签名只会剥掉需要「授权能力（entitlement）」的功能。我们逐项对过，结论是登录和阅读都不受影响：

- **Google 登录回调**：走自定义 URL scheme（`tauri.conf.json` 里 `plugins.deep-link.mobile`，`appLink: false`，反向 client id）。自定义 scheme 是 Info.plist 的 `CFBundleURLTypes` 声明，**不需要任何 entitlement**，免费重签会原样保留，OAuth 回调照收。产线的校验步骤每次都会断言这条 scheme 在 ipa 的 Info.plist 里。
  - 反例提醒：如果哪天把 `appLink` 改成 `true`（走 Universal Links / Associated Domains），那是要 entitlement 的，免费签名会失效、深链接会断。保持自定义 scheme 就没事。
- **用到的插件**：fs、dialog、http、opener、clipboard-manager、os、deep-link，全是普通能力，不吃 entitlement，免费签名下都正常。
- **没用到的**：推送、iCloud、App Groups、后台常驻、Associated Domains 一个都没用——这些恰好是免费签名会阉割的，我们不碰，所以没有隐患。
- **数据同步靠联网**：Google Drive 同步是普通 HTTPS 请求，不依赖任何被阉割的能力。

一句话：这个 app 侧载后除了「7 天要重签」之外，功能和签名版没差别。

## 7. 两个已在产线修掉的坑

- **启动秒崩（__LINKEDIT）**：完全无签名的二进制被 Sideloadly / Dadoum Sideloader 重签时会漏更新 `__LINKEDIT` 段的 vmsize，真机启动即被 dyld 杀掉。产线在出包后先做 ad-hoc 签名，重签名器走「替换签名」的正确路径，规避了这个崩溃。详见 `docs/pitfall/35-ios-unsigned-linkedit-vmsize.md`。
- **主屏没有我们的图标**：`tauri ios init` 默认塞的是 Tauri 占位图标，产线在 init 后把我们的图标覆盖进去，装完主屏显示的是 Reading Partner 自己的 logo。详见 `docs/pitfall/34-ios-init-default-icon-alpha.md`。

## 参考

- Sideloadly FAQ：https://sideloadly.io/faq.html
- 免费 Apple ID 的 7 天 / 3 app 上限说明散见于 Sideloadly / AltStore 社区文档。
