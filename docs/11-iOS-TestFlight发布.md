# iOS TestFlight 发布

账号批下来那天照这个清单做。构建全程在 GitHub Actions 的 macOS runner 上,本地不需要 Mac。CI 配置已就位:`.github/workflows/ios-testflight.yml`(构建加上传加分发)和 `.github/workflows/ios-testflight-distribute.yml`(只分发,手动补救用),bundle id `com.xinyuan.readingpartner`,应用名 Reading Partner。

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

- Name 随意,Access 必须选 **Admin**。云签名要现建 cloud-managed 分发证书,Apple 只放行 Admin 的 key,App Manager 和 Developer 会在 export 阶段报 `Cloud signing permission error`(见 docs/pitfall/47)。key 生成后 access 改不了,选错只能撤销重建。
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
- 日志里的 `No code signing certificates found` 警告和 `Apple Distribution: Tauri (unset)` 证书都是 Tauri 自己的噪音,不是配置错(见 docs/pitfall/48)。签名成没成看 export 阶段。
- Run workflow 的 `inspectable` 输入默认 false,保持不动;只有自己调真机那一次才勾,勾了的包不发给别人。

## 6. TestFlight 配置(一次性)

上传后几分钟到一小时,build 出现在 App Store Connect → 你的 App → TestFlight。

- 出口合规已在包里预答(`ITSAppUsesNonExemptEncryption=false`,只用 HTTPS),正常不会被问。如果界面仍要求回答,选 "None of the algorithms mentioned above" / 不使用非豁免加密。
- Internal Testing → 加号建组(如 `internal`)。External Testing 的组同理。组只在这里建,分发脚本不建组,但会自动带上新建的组。
- 添加测试员:内测测试员必须先是团队成员(Users and Access 里邀请);个人账号自己就是成员,直接把自己的 Apple ID 加进组。外测测试员填邮箱或用公开链接即可。
- iPad 上装 TestFlight app,用同一 Apple ID 登录,接受邮件邀请后即可安装。

## 7. 分发(每次自动)

上传只是把包送进 App Store Connect,处理完就停在那里,谁也装不到。构建 workflow 的 `distribute` job 接着调 `.github/workflows/ios-testflight-distribute.yml`,它跑 `scripts/testflight-distribute.py`:先等这个 build 号在 App Store Connect 里出现(altool 返回时 Apple 还没 ingest 完,build 资源根本不存在,最多等 20 分钟),再等它处理成 `VALID`(最多等 40 分钟),然后加进全部内测组,再走外测那一套。同一个 build 重复跑不会出错,也不会重复提交。

内测和外测分开跑,外测失败不影响内测的结果,结尾统一打一份小结:两边各做到哪一步、卡住的那步 Apple 原话是什么、要去 App Store Connect 补哪一项。有任何一步没做成,退出码非零。

- 内测组:处理完就能装,不过审核。
- 外测组顺序是「查资格 → 写 What's New → 提交 beta 审核 → 加组」。查资格看两个字段:`buildAudienceType` 是 `INTERNAL_ONLY` 的包外测组永远收不了(只能重新导出),`buildBetaDetail.externalBuildState` 是外测独立的状态机,`processingState: VALID` 只代表内测就绪。审核提交排在加组前面是照 fastlane 的顺序,见 `docs/pitfall/107`。
- 外测组:要过 Apple 的 beta 审核,不是即时的;审核通过前外测设备上看不到这个 build。
- beta 审核要 app 级的 Test Information 填全(Beta App Description、Feedback Email、联系人姓名/邮箱/电话,需要登录的还要演示账号)。缺哪项 Apple 在返回里点名,脚本把 `errors[].title` 和 `detail` 原样打出来,并指到 App Store Connect 的对应页面;这时内测已经分发完成,只有外测卡在审核。

手动补救:Actions → iOS TestFlight Distribute → Run workflow,Build 填那次构建的 run number(就是 CFBundleVersion),必填。已经传上去但没分发的包靠这条救回来,不用重新构建一次。不填号取「最新那个」是不安全的:ingestion 期间 API 能看到的最新 build 是上一个,会把旧包分发出去;真要这么干只能本地跑脚本加 `--newest`。本地跑法:导出 `APPLE_API_ISSUER`、`APPLE_API_KEY_ID`、`APPLE_API_KEY_P8_BASE64`(或 `APPLE_API_KEY_PATH`)后 `python3 scripts/testflight-distribute.py --build <run number>`,加 `--dry-run` 只看计划不动东西。脚本的纯决策逻辑有单测:`python3 -m unittest discover -s scripts -t scripts`。

## 8. 之后每次迭代

改完代码合进 main,回到第 5 步再点一次 Run workflow。改版本号(如 0.2.0 → 0.3.0)时同步改 `tauri.conf.json`、`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 四处;不改版本号只发新 build 也行,build number 自增保证可上传。

## 上架前的条款

- 3.1.1(强制内购)不适用:BYOK 不卖数字内容,用户用的是自己在第三方已有的服务。
- 5.1.2(隐私披露):App 隐私清单和界面里要明示"内容会发送给用户自己配置的 AI 提供商"。
- 中国区:境外注册开发者目前不被要求 ICP 备案(2024-04 起大陆商店本要求备案,但备案前置条件是境内服务器+域名,与零后端矛盾)。先上美区,国内用户用外区 Apple ID 下载;有真实需求再补备案。
- 个人开发者账号 $99/年,覆盖全球全部地区,不按地区加钱。

## 已知限制

- 模拟器上能跑 `tauri ios dev` + idb 真触摸 + sim-bridge 取值(`scripts/ios-sim.sh`,基线见 `scripts/ios-sim/baseline.md`);真机远程 inspector 靠 `inspectable` feature 开(`src-tauri/Cargo.toml`,默认关,只能通过 workflow 的 dispatch 输入开)。没有 Mac 意味着没有 Xcode/开发者中心网页之外的真机调试:签名、账号这类环节仍然只能靠 CI 日志和(模拟器/TestFlight)包内表现定位。
- iOS 引擎闸门(EmbedPDF 的 PDFium WASM 在 WKWebView 里能不能渲染)已在模拟器上无签名验证通过:`.github/workflows/ios-simulator-smoke.yml`(推 ios-spike 触发)。实测结论:iOS 自定义协议下 `crossOriginIsolated` 为假、`SharedArrayBuffer` 不存在,但直连引擎单线程照样渲染出页面(见 docs/pitfall/33)。不需要第一个 TestFlight 包来验证闸门。
- Claude 订阅 OAuth 的 loopback 回调在 iOS 不可用,走手动粘贴 code;BYOK 不受影响。
