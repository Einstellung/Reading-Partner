# 发布产物托管

## 愿景

源码仓库改私有后，桌面自动更新和安装包下载仍然正常。安装包和 APK 放在一个免费托管上，将来有一个简单的下载网站。

## 为什么现在不做

用户说不急。仓库保持公开，更新照旧走 GitHub Releases，不会坏。

## 将来做时已知的事实

- 现在的更新地址是 GitHub Releases 的 `latest.json`（`src-tauri/tauri.conf.json` 的 `updater.endpoints`）。仓库私有后匿名请求 404，已装桌面版每 6 小时检查一次，失败被静默忽略，用户收不到更新也不报错。更新地址写死在已装的包里，改不了。
- iOS（TestFlight）不经过 GitHub，不受影响。README 的 releases 链接和 Android APK 下载会受影响。
- 私有仓库的 Actions 按分钟计费，macOS runner 折算 10 倍，Windows 2 倍，Linux 1 倍；iOS 的 TestFlight 构建也跑在 macOS 上。打算是 macOS 桌面包发得慢一点，iOS 和 Android 发得勤一点；iOS 同样吃 macOS 额度，Android 便宜。免费额度（Free 2000 分钟/月，Pro 3000）和当前实际用量没核对过，在 GitHub Settings → Billing 看。
- 调研结论（[发布产物托管调研](../research/发布产物托管调研.md)）：首选 Cloudflare R2（绑自定义域名）加 Pages，备选新建公开产物仓库放 Releases 加 GitHub Pages。候选对比和额度估算见调研。
- 需要一个放进 Cloudflare 的域名（DNS 交给 Cloudflare，整个域名而不是单个子域）。更新地址一旦发出就改不了，所以域名必须能长期持有，用其下的子域名；临时借来的域名不要写进发出去的包里。域名现在还没定。
- 分两步。第一步只做下载链接托管：CI 发版时照发 GitHub Release，同时把安装包再传一份到 R2，给下载页和 README 用；updater endpoints 不动，用 r2.dev 地址当临时下载前缀（r2.dev 限速，只能临时用，不能写进包里）。第二步等域名到位：改 CI 把 `latest.json` 的 url 指向新地址，发一个 endpoints 指向新地址的版本，再改仓库私有。
- 第一步的设计（已想好，没做）：桶内 `android/<version>/`、`desktop/<version>/`，各有固定文件名的 `latest/` 副本（no-cache），版本目录长缓存。配置用 secrets `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET` 加 variable `R2_PUBLIC_BASE`，以后换域名只改这个变量。没配 secrets 时上传步骤跳过，不让发版失败。走 S3 兼容接口，endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，region auto。不加清理旧版本的逻辑，10 GB 免费存储大约放得下十几个全平台版本，快满时再加。Cloudflare 侧要做：建桶、开 r2.dev 公共访问、生成限定到该桶的 Object Read & Write 令牌。
- 旧版本过渡：先发 endpoints 指向新地址的新版本，再把源码仓库改名并改私有，然后用原名 `Einstellung/Reading-Partner` 新建一个公开仓库，里面只放一份指向新版本安装包的 `latest.json`，旧客户端读到后升级。这一步是按 GitHub 文档推出来的，没实测，改名前先拿测试仓库走一遍。
- 开工前要核：R2 开通是否必须绑信用卡、超额是否自动扣费；自定义域名下 `latest.json` 的缓存行为；大陆访问 R2 的实际速度（所有方案都没有官方数据，需要实测）。
- 产品网站先做简单的下载页，放 Cloudflare Pages，和 R2 同账号。
