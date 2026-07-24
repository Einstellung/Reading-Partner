# iOS 自定义 scheme 只能构建期静态注册,且要和 env client id 手工对齐

## 现象

iOS 上 Google OAuth 用反向 client id 自定义 scheme 收回调。想当然会以为：既然 client id 从 `VITE_GOOGLE_IOS_CLIENT_ID` 注入前端，scheme 也能跟着 env 走。实际不行——env 只影响前端 JS,影响不到 Info.plist。scheme 没注册进 Info.plist 时,Safari 授权后跳回自定义 scheme,iOS 找不到能处理该 scheme 的 app,回调石沉大海。

## 原因

- iOS 的 URL scheme 注册在 `CFBundleURLTypes`,是构建期产物。`tauri-plugin-deep-link` 的 build.rs 用 `update_info_plist` 从 `tauri.conf.json` 的 `plugins.deep-link.mobile[].scheme` 生成它——读的是静态 JSON,不是运行时 env。
- deep-link 的运行时 `register()` 只在 desktop（Linux/Windows）有效,iOS/Android 不支持运行时注册 scheme。
- 于是 client id 存在两处、必须一致:`.env` 的 `VITE_GOOGLE_IOS_CLIENT_ID`(完整 `<id>.apps.googleusercontent.com`,前端用)和 `tauri.conf.json` 的 scheme(反向 `com.googleusercontent.apps.<id>`,Info.plist 用)。改了一个忘了另一个,登录就断:scheme 对不上则回调丢失,client id 对不上则 token 交换报 redirect_uri 不匹配。

## 解法

- scheme 写死进 `tauri.conf.json` → `plugins.deep-link.mobile[0]`:`{ "scheme": ["com.googleusercontent.apps.<id>"], "appLink": false }`。反向形式 = 完整 client id 去掉 `.apps.googleusercontent.com` 后缀,前面拼 `com.googleusercontent.apps.`。
- 同步设 `.env` 的 `VITE_GOOGLE_IOS_CLIENT_ID` 为完整 client id,和上面同一个 client。
- CI 的前端构建步骤要能拿到 `VITE_GOOGLE_IOS_CLIENT_ID`,否则包里 client id 为空。
- 别手改 `gen/apple/Info.plist`——会被下次 `tauri ios init` 覆盖。配置源头永远是 `tauri.conf.json`,插件构建期自动注入。
