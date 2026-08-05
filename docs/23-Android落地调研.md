# Android 落地调研

调研日期 2026-07-28,2026-08-05 按落地后的状态改写。前提是 docs/22 定的手机形态:手机只做 info,不加载 EmbedPDF / PDFium WASM。

## 结论

构建这一环已经通了,而且接进了发布线。两条 workflow 在当前代码上跑绿:签名 release APK 出货,PDFium 引擎冒烟在 Android 模拟器上 `ok:true`。打 tag 发版时 `release.yml` 把同一个 APK 挂到 draft release 上,和三个桌面平台并列。签名密钥的四个 secret 已经在仓库里。

要拿主意的是 Google 登录。spike 那条"照抄 iOS,建一个 Android OAuth client 走反向 client id 自定义 scheme"的路线,Google 2023-10-02 起对新建的 Android client 默认关掉了,但没有硬封 —— 在 Cloud Console 该 client 的 Advanced Settings 里可以手动打开。所以代码照 spike 写能通,代价是踩在一个 Google 明说不推荐、随时可能收紧的开关上。loopback 对 Android client 类型是真封死了(Desktop client 类型不受影响)。

## android-spike 三个 commit

### 14ef68b login 布局闸

改的是 AI 供应商(Anthropic / OpenAI)登录卡的按钮布局,不是 Google 同步。当时把 `isIOS()` 换成 `isMobileOS()`,让 Android 也把"用代码登录"提为主按钮。

还能用,但要重写。当时的 `platform.ts` 靠 UA 嗅探,现在已经改成先问 `@tauri-apps/plugin-os` 的 `platform()`,UA 只做非 Tauri 环境的兜底。移植就是按现在的写法加 `isAndroid()`(`platform() === "android"`,兜底 `/Android/`)和 `isMobileOS()`,再把 `src/ui/components/settings/OAuthCard.tsx:52` 的 `isIOS()` 换掉。两个文件,十几行。

前提没验过:commit message 说"Android 和 iOS 一样没有可用的 loopback listener",这是假设。`start_oauth_callback_listener` 在 `lib.rs` 的 mobile invoke_handler 里是注册着的,Android 上 Rust 绑 127.0.0.1 能不能被系统浏览器回调到,没人试过。

### 83574a0 Android Google OAuth flow

`authFlow.ts` / `googleConfig.ts` / `auth.ts` 三个文件从重构以来只搬过位置(`src/sync/` → `src/platform/sync/`),内容一行没动,patch 基本能原样打。改动本身也干净:`AuthFlowKind` 多一路 `android-scheme`,`iosRedirectUri` 泛化成 `schemeRedirectUri`,`signIn()` 的分支从"是 ios 就走 scheme"翻成"是 desktop 就走 loopback"。这部分骨架无论最后选哪条协议路线都用得上。

要重新确认的是它选的路线。Google 的现行规定:

- 新建的 Android 类型 OAuth client 默认不允许用 custom URI scheme 收回调,2023-10-02 生效。但原文同时写了后路:"If you are creating a new app and the recommended alternative doesn't work for your needs, you can enable the Custom URI scheme method for your app in the 'Advanced Settings' section of the client configuration page"([Google Developers Blog](https://developers.googleblog.com/en/improving-user-safety-in-oauth-flows-through-new-oauth-custom-uri-scheme-restrictions/))。也就是 spike 那条路要多一步手工开关,不是不能走。
- loopback 重定向对 Android / iOS / Chrome 三种 client 类型已经封停,最后一批 2022-10-21;Desktop 类型继续支持([Loopback IP Address flow Migration Guide](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration))。
- Google 给 Android 的官方替代是 Google Identity Services Android SDK,原生库,要 Play 服务。
- `client_secret` 对 Android / iOS / Chrome 类型的 client 不适用;iOS 的自定义 scheme 没有被这次限制波及,现在的 iOS 登录路线不受影响。
- 授权页必须开在系统浏览器,不能开在 app 自己的 WebView —— Google 对 `android.webkit.WebView` 直接返回 `disallowed_useragent`,2023-07-24 起强制。`auth.ts` 现在走的就是 `openUrl`,这条已经满足,改的时候别改坏。

还有一条 Android 独有的实现风险:wry 的 `RustWebViewClient.onReceivedError` 里有一段专门的 workaround,注释写着"外部 URL 重定向到自定义协议时会收到 `net::ERR_CONNECTION_REFUSED`,因为重定向不走 `shouldInterceptRequest`"。OAuth 回跳正是这个形状,需要在真机上确认这段 workaround 覆盖到了我们的 scheme。

### 9001b34 两条 workflow(已落到主线)

两条都在当前代码上跑绿。

| workflow | run | 结果 | 时长 |
|---|---|---|---|
| Android APK | 30972780114 | 成功,25.2 MB 签名 arm64 release APK | 9 分 57 秒 |
| Android Engine Smoke | 30972780099 | 成功,verdict `ok:true` | 6 分 43 秒 |

冒烟 verdict 的原文:

```json
{
  "ok": true,
  "stage": "rendered",
  "failLayer": null,
  "crossOriginIsolated": false,
  "hasSharedArrayBuffer": false,
  "userAgent": "Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A.230829.050; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.5672.136 Mobile Safari/537.36",
  "engineReadyMs": 920,
  "openMs": 31,
  "renderMs": 360,
  "pageCount": 1,
  "blobBytes": 1798,
  "renderWidth": 200,
  "renderHeight": 200,
  "nonWhitePixels": 18240,
  "error": null,
  "timestamp": "2026-08-05T03:43:39.061Z"
}
```

和 iOS 那次(坑 33)同一个结论:没有跨源隔离、没有 SharedArrayBuffer,直连引擎照样渲染。verdict 里没有 voice 那几项 —— 那个 probe 已经删了,见下面「麦克风」。

## 从 CI 产物里读出来的硬事实

把 run 30972780114 那个签名 APK 下下来自己拆的,不是转述 CI 的断言:

- package `com.xinyuan.readingpartner`,versionCode 8018,versionName 0.8.18。versionCode 由 Tauri 从版本号算:`major*1000000 + minor*1000 + patch`。
- `minSdkVersion 24`(Android 7.0),`targetSdkVersion 36`,compileSdk 36。minSdk 可以在 `tauri.conf.json` 的 `bundle.android.minSdkVersion` 改。
- 权限两条:`android.permission.INTERNET`(Tauri 模板自带)和 `com.xinyuan.readingpartner.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`(androidx core 为 targetSdk 34+ 的 receiver 自动生成的自有权限,不对外)。
- `debuggable` 没设,`usesCleartextTraffic="false"`。模板在 `defaultConfig` 里设 false、在 debug build type 里设 true(`tauri android dev` 要连明文的 Vite dev server),release 包不需要明文流量:Android 上 Tauri 把页面挂在 `http://tauri.localhost`,由 `shouldInterceptRequest` 拦下来直接喂内嵌资源,不进网络栈,不受明文策略管。`app.windows[].useHttpsScheme` 能换成 https,但换了 IndexedDB / localStorage / cookie 的落点就变了,老数据读不到,别动。
- `tauri.conf.json` 里那条 deep-link scheme(`com.googleusercontent.apps.379091688229-...`,iOS client 的反向 id)已经生成进 AndroidManifest 的 intent-filter,和 iOS 的 Info.plist 是同一份配置源(坑 31 对 Android 同样成立)。也就是说 Android 包现在带着 iOS client 的 scheme。
- 只有一个 ABI:`lib/arm64-v8a/libreading_partner_lib.so`,未压缩存放,zip 里的数据偏移按 16 KB 对齐,ELF 的 LOAD 段对齐 `0x4000`。NDK r28c 的默认对齐确实生效了。
- 签名证书 `CN=Reading Partner, O=Reading Partner, C=CN`,RSA 4096 / SHA384withRSA,有效期到 2066-07-18,SHA-1 `CB:1B:AD:0E:0C:DE:DE:6A:F1:50:1E:5D:EF:9D:AB:F5:19:AF:90:83`,SHA-256 `6E:19:68:AC:CC:77:46:3D:00:61:5D:4E:35:03:A4:5E:F2:58:64:14:15:F6:DA:4E:CE:76:57:5F:3E:6A:16:2B`。v2 + v3 两个方案验过。**这和 2026-07-28 那版文档里记的 SHA-1 不是同一张证书** —— repo secrets 里那四个是 2026-07-28 重建的,旧的那张(`86:88:...`,到 2053 年)已经不在用。建 Android OAuth client 要填的是上面这个 SHA-1。

## CI

这条线的形状,对照 `ios-testflight.yml`:ubuntu-24.04 runner,setup-java 17 + setup-bun + `dtolnay/rust-toolchain`(target `aarch64-linux-android`)+ `android-actions/setup-android`,再用 sdkmanager 装钉死的 NDK 和 build-tools `36.0.0`。`bun tauri android init --ci` 现生成 `gen/android`(和 `gen/apple` 一样不入库),`bun tauri android build --apk --target aarch64` 出未签名 APK,再 zipalign + apksigner 用 base64 keystore 签,最后 `apksigner verify` 加 aapt2 校包名和非 debuggable。全程不改 gradle —— [Tauri 官方文档](https://v2.tauri.app/distribute/sign/android/)的做法是往 `gen/android/app/build.gradle.kts` 里加 `signingConfigs` 再配一个 `keystore.properties`,而 `gen/android` 每次 init 重生成,那条路要么把生成物入库要么每次打补丁,外挂 apksigner 更省事。

`--target aarch64` 出来的包仍然落在 `outputs/apk/universal/release/app-universal-release-unsigned.apk`:`universal` 指的是没按 ABI 拆包,不是"含所有 ABI"。所以 workflow 用 `find` 找 APK,不写死路径。

签名密钥已经在 repo secrets 里:`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`,2026-07-28 建的。alias 那个 secret 的取值也出现在 APK 文件名里,于是 Actions 日志把那一段打成 `***`(`staged: ***-0.8.18-android-arm64.apk`)。产物本身的名字是完整的,只是日志里看不全。

NDK 从 spike 的 `26.3.11579264` 换成 `28.2.13676358`(r28c)。理由是 16 KB page size:r28 是第一个默认按 16 KB max-page-size 链接共享库的 NDK,跑 16 KB 内核的机器加载不了 4 KB 对齐的 `.so`。原来那条"专门下 26.x 是白花时间"的顾虑不成立了 —— ubuntu-24.04 镜像现在预装 27.3.13750724、28.2.13676358、29.0.14206865 三个,整个 sdkmanager 步骤四秒跑完,一个字节都没下。钉着的意义只剩"镜像换默认时不跟着动"。

对齐不靠这个 pin 保证:APK 打完之后有一步从产物里 `unzip` 出 `lib/*/*.so`,用 `readelf` 逐段断言 LOAD 的对齐是 0x4000 或 0x10000,再用 `zipalign -c -P 16` 断言 zip 里的 `.so` 条目也按 16 KB 排。`-P` 是 build-tools 35 才有的参数,spike 钉的 34.0.0 上直接退 2,这是坑 104。

冒烟那条多一段:装 x86_64 + arm64 的 universal debug APK,`reactivecircus/android-emulator-runner` 启 API 34 google_apis 模拟器,`adb run-as` 从 app 私有目录读回 verdict。gate 脚本单独放 `.github/scripts/android-smoke-gate.sh`,因为 emulator-runner 的内联 `script` 是逐行喂 dash 的,多行 shell 会散架。

`android-apk.yml` 同时是 `workflow_call`,`release.yml` 打 tag 时把它当第四个平台调,`secrets: inherit`,`needs: app`。desktop 那三个包由 `tauri-apps/tauri-action` 出,顺手建那份 draft release —— release 是它建的,所以 APK 这一步必须排在它后面,建完才有东西可挂。挂的动作是 `gh release upload <tag> <apk> --clobber`;`gh` 认 draft release 的 tag 名(实测过一次:建一个 draft、传一个文件、再传一次覆盖,都成,`isDraft: true`)。没有 tag 时(`workflow_dispatch`、push)`release_tag` 是空的,那一步跳过,APK 只留在 workflow artifact 里 —— run 30972780114 实测就是 skipped。APK 只构建一次,不复制第二条产线。

这条线分开验过四件:`gh release upload` 认 draft 的 tag 名;没 tag 时那一步 skipped(run 30972780114);`release.yml` 在 android-spike 上 `workflow_dispatch` 一次,GitHub 把 `android` 解析成了真的一个 job 并挂在 `needs: app` 后面(run 30973489551,起来几秒就取消掉了,desktop 那三条没跑完,也没建出 release);APK 本身出货。没验的是把这四件串起来:tag 触发、`release_tag` 真的非空、挂到 tauri-action 刚建的那份 draft 上。要知道只有真打一个 tag。

还有一条形状上的取舍:`needs: app` 意味着 desktop 三个平台里任何一个红了,APK 这一步就不跑。draft release 仍然在(先跑完的那条腿建的),但里面没有 APK。

Android 的构建不注入任何 `VITE_GOOGLE_*`。`selectAuthFlow()` 没有 android 分支,把 desktop client 烤进去等于让 Android 走一条没人跑过的 loopback;不注入就是 Settings > Sync 显示"Google client not configured",按钮禁用。等 OAuth 路线拍板再说。

`tauri-apps/tauri-action` 从 2026-06-29 的 `action-v1.0.0` 起有个实验性的 `mobile: android` 入参,但它只是把 `tauri build` 换成 `tauri android build`,工具链还得自己装,签名也不管。现有这条手写的线做的事更多,没有换过去的理由。官方文档的 GitHub pipelines 页至今没有 Android 内容。

和 iOS 那条线比,Android 这条便宜得多:ubuntu runner 计费是 macOS 的十分之一,七到十分钟,不需要 Apple 账号、证书、描述文件,也没有 TestFlight 的审核延迟。

## 分发

自用直装 APK,不上架。

签名密钥就是升级身份。换了密钥,手机会拒绝覆盖安装已有的那份,只能先卸载,而卸载连数据一起带走。GitHub secrets 是只写的,导不出来,所以本地必须留一份 keystore 备份。

versionCode 必须严格递增才能覆盖安装。Tauri 从 `tauri.conf.json` 的版本号算,补丁号 +1 就够(0.7.6 → 7006)。

未知来源安装:Android 8 起不是一个全局开关,而是按来源 app 授权 —— 用浏览器下载就给浏览器授权,用文件管理器点就给文件管理器授权。第一次装会自动引导到那个页面。不需要 `usesCleartextTraffic`。

产物是单 ABI 的 arm64 APK,0.8.18 是 25.2 MB(2026-07 的 0.6.1 是 11.45 MB,涨的是前端和 `pdfium.wasm`)。要在模拟器上跑就得另出 x86_64,或者出 universal —— 冒烟那条就是 universal,而且是 debug,139 MB。

**这条路线有个中期变数:Android developer verification。** Google 要求装到认证 Android 设备上的 app 来自已验证的开发者,2026-03 面向所有开发者开放,2026-09-30 起在巴西、印尼、新加坡、泰国开始强制,2027 及以后全球铺开([Android Developers Blog](https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html))。对我们的影响:

- 有免费的业余层,不交注册费、不用交身份证件,但限 20 台设备以内。
- 注册绑的是包名加签名证书的 SHA-256 —— 又一个"keystore 必须永久保留"的理由。
- 未注册的 app 仍可以走 ADB 装,Google 明写了这条留给开发者和高级用户。

也就是说最坏情况下自用直装退化成"用数据线 adb install",不是完全堵死。中国大陆不在首批名单里,但这件事要记在账上。

## Android 特有的坑

**WebView 版本。** Tauri v2 官方支持到 Android 7.0(SDK 24),我们的包也是 minSdk 24。但 Tauri 不自带 WebView,用的是系统的 Android System WebView,所以真正决定能不能跑的是设备上那个组件的版本,不是系统版本([Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/))。冒烟跑的是模拟器镜像自带的 Chrome 113。旧机型上 WebView 长期不更新会怎样,没验 —— 需要真机。

**存储路径。** Tauri 在 Android 上 `app_data_dir()` 直接返回 `getDataDir`,就是 app 私有目录,不再拼 bundle id(源码 `tauri-2.11.5/src/path/android.rs`,和 iOS 同构)。含义:卸载即清空,用户在文件管理器里看不见。manifest 没设 `allowBackup`,默认开着,系统的 Auto Backup 可能顺手把私有目录传一份到用户的 Google Drive,但有 25 MB 上限且不可控,不能当备份手段。唯一可靠的备份是我们自己的 Drive 同步。fs 插件加现有的 `$APPDATA` capability 在 Android 上已经验证可用 —— 冒烟就是靠它 mkdir 加写文件把 verdict 落盘的。坑 09(glob 不匹配目录本身)和坑 36(根目录没人建,已由 Rust setup 兜住)在 Android 上同样适用,两个都已经是解决状态。

**网络。** INTERNET 权限模板自带。Drive 和 AI 的请求全走 `tauri-plugin-http`(Rust reqwest),不经 webview,所以没有 CORS、没有明文策略、没有 WebView 版本依赖。坑 15 / 28 / 54 的结论跨平台通用。

**麦克风。** 现在 `src/ai/voice/` 走的是 Rust cpal,`#[cfg(desktop)] mod voice`,移动端整个编译掉,`start_voice_recording` 这个命令在 iOS 和 Android 上都不存在 —— 这是移动端的共同缺口,不是 Android 特有的。

Android 要走 web 的 `getUserMedia`。好消息:wry 0.55.1 的 `RustWebChromeClient.onPermissionRequest` 已经把 `AUDIO_CAPTURE` 映射成运行时申请 `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`,拿到就 `request.grant()`(源码在 wry crate 的 `src/android/kotlin/RustWebChromeClient.kt`)。缺的是 manifest 里那两行声明 —— 未声明的权限申请会被系统立刻拒绝,于是走到 `request.deny()`。两行都要:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

漏的通常是第二行。[tauri#10846](https://github.com/tauri-apps/tauri/issues/10846) 就是这个:只声明 `RECORD_AUDIO` 时 `getUserMedia({audio:true})` 报 `not-allowed`,补上 `MODIFY_AUDIO_SETTINGS` 才好。

`gen/android` 不入库,所以补这行权限有三条路。一是照 iOS 那条线 init 之后补图标的做法,在 CI 里加一步 patch manifest。二是把 `gen/android` 入库 —— Tauri 维护者的建议就是提交它,生成的 `.gitignore` 已经排掉了 `keystore.properties` / `local.properties` / 构建产物;顺带 `autoIncrementVersionCode` 也要求把 `tauri.properties` 提交进去才能用。三是用 `tauri_plugin::mobile::update_android_manifest`,deep-link 插件注入 intent-filter 走的就是它,在自己的 `build.rs` 里调理论上可行(它只依赖 CLI 设的 `TAURI_ANDROID_PROJECT_PATH`),但仓库里所有在用的都是插件的 build.rs,当 app 用没见过先例,算未验证。

`http://tauri.localhost` 应该是 secure context(Chromium 把 `.localhost` 结尾的 host 当可信来源),`navigator.mediaDevices` 因此应该存在 —— 应该,仍然没实测。原来指望的 `src/smoke/voice-probe.ts` 已经不在了:2026-07-29 定了语音输入只做桌面(docs/15、docs/22),那个 probe 和它服务的 docs/20 一起删掉(e9f4f4e)。手机上真要语音再把 probe 加回来重跑一次冒烟,一次运行就有 Android 那张能力表;在那之前这条不值得为它单独动 `src/`。

**安全区。** 结论取决于设备上 WebView 的版本,不是取决于我们写什么。

前置条件我们已经满足:Tauri CLI 2.7.0 起生成的 `MainActivity.kt` 里就有 `enableEdgeToEdge()`,`index.html` 的 viewport 也已经带 `viewport-fit=cover`。Android 15(API 35)强制 edge-to-edge,`windowOptOutEdgeToEdgeEnforcement` 那个逃生开关在 targetSdk 36 上已被禁用,退不出去。

WebView 侧按 Google 自己的[文档](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)分三档:M136 起把 `displayCutout()` + `systemBars()` 喂给 CSS,但只对全屏 WebView;M139 起键盘 inset 对所有 WebView 生效;**M144 起才是所有 WebView 都拿得到 `displayCutout()` + `systemBars()`**。也就是说 WebView 够新(M144,约 2026 年年中)`env(safe-area-inset-*)` 就直接能用,旧的拿到 0 或者只在全屏下有值。Tauri 侧那条报告([tauri#14142](https://github.com/tauri-apps/tauri/issues/14142),开着没人接,关联 #11475)对应的正是旧 WebView 那一档。

所以 `src/styles.css` 里那套 `safe-*` utility(全都是 `env(safe-area-inset-*)`)在 iOS 上生效,Android 上要么生效要么全 0,取决于机器。稳的做法是从 Kotlin 侧读 `WindowInsetsCompat` 喂成 CSS 变量,只押 `env()` 等于押用户的 WebView 够新。第 2 步的模拟器截图能确认一档,真机是另一档。

**返回键。** 已经接上了,`src/platform/app/back-button.ts`:手机外壳有地方可退时绑 `onBackButtonPress`,退到栈底就解绑,把按键还给系统。注意那里写的所有权语义 —— 绑着的时候按键再也退不出 app,而 tauri 2.11.5 的 `exit` 命令没有 ACL 权限,JS 侧叫不动。这条 iOS 上不存在,是 Android 独有的,而且没在真机上按过。

## Google Drive 同步

`driveBackend.ts` 全程走 `cleanTauriFetch` → `tauri-plugin-http`,请求在 Rust 侧发,平台无关,Android 上不需要任何改动。token 存 `AppData/sync-auth.json`,刻意不在同步范围内(`syncFs.ts`),Android 上就是 app 私有目录里的一个文件,和 iOS 同构。

所以同步能不能跑,只卡在一件事:Android 拿不拿得到那个 refresh token。见上面的 OAuth。

## 不加载 PDFium 省掉了什么

少一个已经答过的风险点,不是少一半工作量。

引擎闸门在 Android 模拟器上绿过两次(2026-07-24、2026-08-05)—— PDFium WASM 能不能在 Android WebView 里渲染,不是未知数,是已知的"能"。真正贵的是触摸那一大摊(坑 37-46、50、56-63 全是引擎和手势,几乎全在 iPad 上一条条踩出来的),而那本来就不在手机形态的范围里。

包体积一分没省:外壳是运行时按宽度选的,`pdfium.wasm`(4.6 MB)还在包里。docs/22 已经写了这条,Android 上同样成立。

## 落地路径

**第 0 步,CI,已完成(2026-08-05)。** 两条 workflow 在当前代码上跑绿,APK 接进了 release 线。没碰产品代码。

**第 1 步,改代码。** OAuth 路线拍板之后动 `authFlow` / `googleConfig` / `auth` / `platform.ts`。骨架照 83574a0,协议照拍板结果。单测在 `authFlow.test.ts` 里,CI 能验。

**第 2 步,模拟器,CI 可无人值守。** 装非 smoke 的真 app,截图看手机外壳的排版和安全区。emulator-runner 已经能 `adb exec-out screencap`,现成的。注意模拟器镜像的 WebView 版本决定了 `env(safe-area-inset-*)` 有没有值,所以这一步只能给出"这个 WebView 版本上是什么样",给不出普遍结论。

**第 3 步,真机,必须。** 登录全链路、麦克风权限弹窗、Drive 同步、装完再升级一次验签名一致、目标机器上的 WebView 版本和安全区。这些模拟器都替不了。

## 要拍板的

1. **有没有 Android 真机?** 型号和系统版本?没有的话第 3 步整个做不了,只能停在模拟器,登录和同步就永远是纸面结论。
2. **keystore 本地有没有备份?** GitHub secrets 导不出来。丢了就再也升级不了已经装上的那份,只能卸载重装、数据从 Drive 拉回来。
3. **OAuth 走哪条?**
   - 照 spike:新建 Android client,在 Advanced Settings 里手工打开 custom URI scheme。改动就是 83574a0 那份 patch,是三条里最省力的,代价是踩在 Google 明说不推荐的开关上。要注意 Android client 绑定签名证书的 SHA-1,换 keystore 就要同步改。
   - 复用 iOS client id,让 Android 走现有的 ios-scheme 分支。改动最小(scheme 已经在 manifest 里了),但不合规、没实测,Google 随时可能拦。
   - Desktop client 配 loopback。Desktop 类型不在废弃名单里,协议上站得住。`oauth_callback.rs` 就是 std 的 `TcpListener::bind((127.0.0.1, port))`,Android 上绑回环不要任何权限,系统浏览器访问同机回环也不受限,原理上应该通。没实测,而且 app 退到后台等浏览器授权时进程会不会被回收要一起验。
   - 写一个 Kotlin 的 Tauri 插件接 Google Identity Services。唯一的合规路线,工作量最大,还引入 Play 服务依赖。
