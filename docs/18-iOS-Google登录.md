# iOS 上的 Google Drive 同步登录

桌面用 Google Desktop client + loopback 回调（docs/13）。iOS 上 loopback 失效（app 切系统浏览器后本地监听收不到回调），且 Google 封锁内嵌 webview 登录。iOS 走正规路线：iOS 类型 OAuth client（无 secret）+ 反向 client id 自定义 scheme 回调 + 系统浏览器授权。

## 分叉设计

分叉点收敛在 `src/sync` 内部，调用方（index.ts、SettingsView）无感。

- `authFlow.ts`：纯函数。`selectAuthFlow(platform, env)` 按平台返回 `AuthFlow`（`desktop-loopback` 或 `ios-scheme`），未配置返回 null。`buildAuthUrl`、`authCodeBody`、`refreshBody`、`matchesRedirect`、`parseCallbackParams`、`reversedClientId`、`iosRedirectUri` 都在这里，全部单测覆盖（`authFlow.test.ts`）。
- `googleConfig.ts`：读 env（`VITE_GOOGLE_CLIENT_ID`/`VITE_GOOGLE_CLIENT_SECRET` 桌面，`VITE_GOOGLE_IOS_CLIENT_ID` iOS），用 `@tauri-apps/plugin-os` 的 `platform()`（同步）判平台，`isGoogleConfigured()` 和 `activeAuthFlow()` 都平台感知。
- `auth.ts`：`signIn()` 按 `flow.kind` 分叉。桌面走 `captureLoopbackCode`（原封不动，复用 Rust `start_oauth_callback_listener`）。iOS 走 `captureSchemeCode`（deep-link 收回调）。token 交换共用 `tokenRequest`，body 由 `authCodeBody`/`refreshBody` 决定——iOS 不带 `client_secret`，桌面带。PKCE(S256) 两边都有，桌面本来就有，直接复用。

平台判定：`platform()` 只识别 `"ios"` 走 scheme 流，其余（macos/windows/linux/未知）一律 loopback。非 Tauri 环境（纯 vite dev）catch 成 `"unknown"`，登录按钮 disabled，app 照常加载。

## deep-link 接法与版本

- `tauri-plugin-deep-link` 2.4.x（`@tauri-apps/plugin-deep-link` 配套），`tauri-plugin-os` 2.3.x（`@tauri-apps/plugin-os`）。官方维护。
- Rust 侧：`lib.rs` 注册 `tauri_plugin_deep_link::init()` 和 `tauri_plugin_os::init()`，无 Swift 代码。回调全在前端收，Rust 不写 `on_open_url`。
- 前端：`onOpenUrl(cb)` 收运行中回调，`getCurrent()` 兜底冷启动带入的 URL，两个都接（`captureSchemeCode`）。收到 `com.googleusercontent.apps.<id>:/oauth2redirect?code=...&state=...`，自己 parse 并比对 pending state（桌面是 Rust 监听器按 state 匹配，iOS 在 JS 侧比对）。
- scheme 只能静态注册，不支持运行时 `register()`（那是 desktop-only）。scheme 固定（反向 client id），无影响。
- capability：`deep-link:default`（getCurrent）+ `os:allow-platform`。opener 白名单已含 `accounts.google.com`，token 端点 `oauth2.googleapis.com` 走 http 桥、capability 桌面已放行，iOS 复用。

## gen/apple 接线清单

`src-tauri/gen/apple` 不入库，CI 里 `tauri ios init --ci` 生成，`tauri ios build` 构建。deep-link 插件的 build.rs 在 iOS 构建时用 `update_info_plist` 从 `tauri.conf.json` 的 `plugins.deep-link.mobile[].scheme` 自动生成 Info.plist 的 `CFBundleURLTypes`。所以正常情况下无需手改 gen/apple。

必须落地的配置（已在本分支完成，除占位符替换）：

1. `tauri.conf.json` → `plugins.deep-link.mobile[0].scheme` = `["com.googleusercontent.apps.<你的反向 client id>"]`，`appLink: false`。已填入本仓库的 iOS client（379091688229-esc23unqq02igufrjr9jjvtsug49j097）。
2. `.env` → `VITE_GOOGLE_IOS_CLIENT_ID` = 完整 iOS client id（`<id>.apps.googleusercontent.com`）。前端构建时读，必须和上面 scheme 指向同一个 client。

gen/apple 落地后要核对（后续批次接上时验一遍）：

- 构建产物 `src-tauri/gen/apple/*/Info.plist` 里出现一条 `CFBundleURLTypes` → `CFBundleURLSchemes` = `com.googleusercontent.apps.<id>`（不带 `://` 和路径段）。若因插件行为变化没自动生成，手动加这一条即可（key/值同上）。别手改再被 `tauri ios init` 覆盖——配置源头始终是 `tauri.conf.json`。
- CI（`.github/workflows/ios-testflight.yml`）的 `bun run build` 步骤要能拿到 `VITE_GOOGLE_IOS_CLIENT_ID`（加进 workflow env 或 secret），否则 iOS 包里 client id 为空、登录按钮 disabled。

## Google Cloud Console 操作步骤（用户侧）

1. 打开 Google Cloud Console，选中放桌面 client 的同一个项目（Drive API 已启用、同意屏幕已发布 In production）。
2. APIs & Services → Credentials → Create Credentials → OAuth client ID。
3. Application type 选 **iOS**。
4. Bundle ID 填 `com.xinyuan.readingpartner`。
5. 创建后拿到 Client ID，形如 `1234567890-abcdef.apps.googleusercontent.com`（iOS client 没有 client secret，正常）。
6. 两处填写，必须一致：
   - `.env` 里 `VITE_GOOGLE_IOS_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com`
   - `src-tauri/tauri.conf.json` 里把 scheme 占位符替换成反向形式 `com.googleusercontent.apps.1234567890-abcdef`（去掉 `.apps.googleusercontent.com` 后缀，前面拼 `com.googleusercontent.apps.`）。
7. 同意屏幕的 scope 和桌面共用（`drive.file openid email`），无需额外配置。

## 真机待验项

本轮无 iOS 真机/gen/apple，以下只能上真机确认：

- Safari 授权后经自定义 scheme 跳回 app，`onOpenUrl` 能收到完整回调 URL 且 state 比对通过。
- 自定义 scheme 跳回前 Safari 会弹一次"用 App 打开?"插页，是固有体验；要去掉得上 ASWebAuthenticationSession（需原生插件），本轮不做。
- 冷启动兜底：登录中途 app 被系统回收、经 deep link 冷启动带回 URL 时，JS 侧的 pending state/verifier 已丢失，`getCurrent()` 拿到 code 也无法完成交换。真机观察这个概率；若常发生，需把 PKCE verifier + state 持久化后在冷启动路径续跑。当前实现覆盖 app 保活（大概率）的正常路径。
- token 交换不带 secret 是否被 Google iOS client 接受（预期是，PKCE 保护），以及 `redirect_uri` 的路径段以 Console 实际展示为准（惯例 `:/oauth2redirect`）。
