# iOS TestFlight 发布

账号批下来那天照这个清单做。构建全程在 GitHub Actions 的 macOS runner 上,本地不需要 Mac。CI 配置已就位:`.github/workflows/ios-testflight.yml`,bundle id `com.xinyuan.readingpartner`,应用名 Reading Partner。

## 1. 注册 App ID(一次性)

developer.apple.com → Account → Certificates, Identifiers & Profiles → Identifiers → 加号 → App IDs → App。

- Bundle ID 选 Explicit,填 `com.xinyuan.readingpartner`。
- Description 随意(如 Reading Partner)。
- Capabilities 全部保持默认,不勾。

## 2. App Store Connect 建 App 条目(一次性)

appstoreconnect.apple.com → My Apps → 加号 → New App。

- Platforms:iOS。
- Name:`Reading Partner`(全球唯一,被占就用 `Reading Partner — AI Reading Companion`)。
- Primary Language:English (U.S.)。
- Bundle ID:选第 1 步注册的那个。
- SKU:`reading-partner`(内部标识,用户看不到,建了不能改)。
- User Access:Full Access。

## 3. 生成 App Store Connect API key(一次性)

appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API → Team Keys → Generate API Key。

- Name 随意,Access 选 **App Manager**(CI 云签名要自动建分发证书,Developer 权限可能不够)。
- 记下页面顶部的 **Issuer ID** 和这把 key 的 **Key ID**。
- 下载 `AuthKey_<Key ID>.p8`,只有一次下载机会,存好。

Team ID 在 developer.apple.com → Account → Membership details,10 位字符串。

## 4. 填 GitHub secrets(一次性)

仓库 Settings → Secrets and variables → Actions → New repository secret,四个:

| Secret 名 | 内容 |
|---|---|
| `APPLE_API_ISSUER` | Issuer ID(UUID) |
| `APPLE_API_KEY_ID` | Key ID(如 `2X9R4HXF34`) |
| `APPLE_API_KEY_P8_BASE64` | `base64 -w0 AuthKey_<Key ID>.p8` 的输出 |
| `APPLE_TEAM_ID` | Team ID |

## 5. 跑 workflow(每次发布)

Actions → iOS TestFlight → Run workflow(main 分支)。20-40 分钟。

- 版本号读 `src-tauri/tauri.conf.json` 的 `version`,build number 是 run number,每跑一次自动 +1。
- 首跑时云签名会自动创建 Apple Distribution 证书和 provisioning profile,不用手动建。
- 失败看对应 step 日志;只要 ipa 已产出,即使上传失败也会留成 artifact。

## 6. TestFlight 配置(一次性)

上传后几分钟到一小时,build 出现在 App Store Connect → 你的 App → TestFlight。

- 出口合规已在包里预答(`ITSAppUsesNonExemptEncryption=false`,只用 HTTPS),正常不会被问。如果界面仍要求回答,选 "None of the algorithms mentioned above" / 不使用非豁免加密。
- Internal Testing → 加号建组(如 `internal`),勾选自动分发新 build。
- 添加测试员:测试员必须先是团队成员(Users and Access 里邀请);个人账号自己就是成员,直接把自己的 Apple ID 加进组。
- iPad 上装 TestFlight app,用同一 Apple ID 登录,接受邮件邀请后即可安装。内部组的 build 不经 beta 审核,上传处理完就能装。

## 7. 之后每次迭代

改完代码合进 main,回到第 5 步再点一次 Run workflow。内部测试组会自动收到新 build。改版本号(如 0.2.0 → 0.3.0)时同步改 `tauri.conf.json`、`package.json`、`src-tauri/Cargo.toml` 三处;不改版本号只发新 build 也行,build number 自增保证可上传。

## 已知限制

- 没有 Mac:不能 `tauri ios dev` 真机调试,不能用 Safari 远程 inspector,一切问题只能靠 CI 日志和 TestFlight 包内表现定位。
- iOS 首次闸门验证(EmbedPDF 的 pthread WASM 在 WKWebView 里能不能跑,依赖 SharedArrayBuffer 和跨源隔离,COOP/COEP 头已在 `tauri.ios.conf.json` 预埋)只能通过第一个 TestFlight 包完成。
- iOS 包只含 EmbedPDF 引擎(workflow 里 `VITE_ENGINE=embedpdf`),zotero/reader 引擎因 AGPL 与 App Store 条款冲突不进 iOS 包(见 docs/06)。
- Claude 订阅 OAuth 的 loopback 回调在 iOS 不可用,走手动粘贴 code;BYOK 不受影响(见 docs/06)。
