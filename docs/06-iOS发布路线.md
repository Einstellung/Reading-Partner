# iOS 发布路线

2026-07-14 调研定稿。目标:Apple 个人开发者账号,TestFlight 先行,美区公开上架,中国区暂缓。开发者无 Mac,构建全程走 GitHub Actions 的 macOS runner(公开仓库免费)。

## 最大阻塞:zotero/reader 的 AGPL 与 App Store

App Store 的使用条款与 AGPL 第 6 条冲突(FSF 反复确认过,VLC 曾因此下架)。只有版权持有人能豁免。reader 版权属 Corporation for Digital Scholarship,纯 AGPLv3,无 App Store 例外条款;且 Zotero 在主动执法(2026-03 对第三方工具 Vibero 发过整改要求)。

我们的姿态比违规者干净:全项目 AGPL 开源、守 copyleft、不用 Zotero 商标。但上架前必须拿到 CDS 的书面许可(对 reader 加 section 7 App Store 例外,或一句书面允许)。信稿见本文末。拿不到则三选一:换阅读引擎 / 放弃商店只自行分发 ipa / 明知有下架风险硬上(不建议)。

我们自己持版权的壳代码,LICENSE 要加 section 7 App Store 例外(上架前做)。

## CI 构建管线(无 Mac,2-4 天)

- macOS runner 上 `tauri ios init --ci` 生成 `src-tauri/gen/apple`,提交进仓库;
- 签名走 App Store Connect API Key(三个 secrets:APPLE_API_ISSUER / APPLE_API_KEY / APPLE_API_KEY_PATH),证书/描述文件网页端 + CI 完成;
- `tauri ios build` 出 .ipa → fastlane pilot(或 xcrun altool)传 TestFlight;
- 所用插件(fs/dialog/http/opener/clipboard-manager)均为官方插件,全部支持 iOS。

## iOS 上的 Claude 订阅登录

桌面的 loopback 自动回调在 iOS 失效:App 切到浏览器即被系统挂起,本地监听收不到回调;且 WKWebView 不允许重定向到非 http(s) scheme。Anthropic OAuth 的 redirect URI 是注册死的 localhost:53692,自定义 scheme 大概率不可配。

v1 决定:iPad 上走手动粘贴 code(兜底已实现,授权页带 code=true 会显示 code)。体验多一步,能用。将来若 Anthropic 开放自定义 scheme 回调再升级。BYOK(贴 API key)不受影响。

## 中国区:暂缓

2024-04 起中国大陆商店要求 ICP 备案号,但**境外注册开发者目前不被要求**。备案前置条件是境内服务器+域名,与零后端矛盾。策略:先上美区等海外区(国内用户用外区 Apple ID 可下载);将来有真实需求再买占位 ECS+域名办个人 App 备案(阿里云流程,3-22 个工作日;个人非经营性备案不得用于收费,BYOK 免费形态没问题)。

## 账号与审核

- 个人账号 $99/年(中国区 ¥688,同一笔钱),覆盖全球全部地区,不按地区加钱。个人 vs 组织仅署名与团队功能之差。
- 3.1.1(强制内购)不适用于 BYOK:我们不卖数字内容,用户用的是自己在第三方已有的服务。
- 审核重点在 5.1.2 隐私披露:App 隐私清单和界面里明示"内容会发送给用户自己配置的 AI 提供商"。零后端、数据全本地、开源,是审核眼里最干净的形态。
- Tauri(WKWebView)不是审核障碍,先例:Readest(同为 AGPL+Tauri,已上架;但它引擎版权在自己手里,与我们的 AGPL 处境不同)。

## 时间线

| 阶段 | 内容 | 周期 | 阻塞 |
|---|---|---|---|
| 0 | CDS 许可请求 + 注册开发者账号 + 壳 LICENSE 加例外 | 1-3 周 | CDS 回复(成败未知) |
| 1 | CI 管线(init/签名/TestFlight 上传) | 2-4 天 | 账号就绪 |
| 2 | iPad 适配(布局触屏过一遍;登录走粘贴) | 与 1 并行 | — |
| 3 | TestFlight 内测→外测 | 1-2 周 | 外测过一次 beta 审核 |
| 4 | 美区上架 | 审核 1-3 天 | 阶段 0 的许可 |
| 5 | 中国区 | 暂缓 | 备案 |

## 给 CDS/Zotero 的许可请求信(用户以本人名义发)

发送渠道:zotero/reader 仓库开 GitHub issue,或论坛 forums.zotero.org。信稿:

---

Subject: Request for an App Store exception for zotero/reader (AGPL section 7)

Hi Zotero team,

I'm building Reading-Partner (https://github.com/Einstellung/Reading-Partner), an open-source AI reading companion. It embeds zotero/reader as its reading and annotation engine — unmodified, pinned as a git submodule, built with a small build-config-only patch. The whole application is licensed under AGPL-3.0, the source is public, and we don't use the Zotero name or branding anywhere in the product.

I'd like to distribute the app on the Apple App Store (a free, open-source listing — no paid features). As you know, the App Store's usage rules conflict with AGPL section 6, and only the copyright holder can resolve this. So I'm asking: would the Corporation for Digital Scholarship be willing to grant an additional permission under AGPL section 7 allowing distribution of zotero/reader through the Apple App Store — either as a general exception in the repository, or as a written permission specific to this project?

I'm happy to add any attribution you'd like in the app and its listing, and to keep the full corresponding source public as we already do. If there's anything about our usage you'd like changed, I'll gladly comply.

Thank you for open-sourcing the reader — it's a remarkable piece of engineering.

Best regards,
Xinyuan (github.com/Einstellung)

---
