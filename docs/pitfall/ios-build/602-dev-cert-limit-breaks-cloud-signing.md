# 602 开发证书满额，云签名的 .dev 包和 WDA 一起编不出来

现象：2026-10-14 `ios-linux-loop.yml` 在 hv/harness（run 38555148709）和 hv/integrate（run 38558162574）上连续失败，代码没问题。`wda` 和 `devbuild` 两个 job 都报 `Choose a certificate to revoke. Your account has reached the maximum number of certificates`，接着 `No profiles for 'com.xinyuan.readingpartner.dev' were found`（WDA 是 `com.xinyuan.wda.xctrunner`）。10-12 之前同一 workflow 一直绿。

原因：CI 走 ASC API key 加 `-allowProvisioningUpdates`，runner 是全新的钥匙串，每次都让 Apple 新建一张 Apple Development 证书。账号的开发证书有上限，满了以后 Xcode 不会自己吊销旧的，签名直接失败，profile 也就建不出来。

解法：CI 复用一张固定的 Apple Development 证书。两个签名 job 先跑 `scripts/ios-linux/import-dev-cert.sh`，把 secret `IOS_DEV_CERT_P12_BASE64`（p12 的 base64）用 `IOS_DEV_CERT_PASSWORD` 导入临时钥匙串；自动签名在钥匙串里找到可用身份就直接用它，只建或更新 profile，不再新建证书。签完由 `scripts/ios-linux/check-dev-cert.sh` 核对 app 的签名证书 SHA-1 等于导入的那张，不等就失败。这张证书是 2026-10-16 用 ASC API 建的（id RPPZGVPQB8，2027-10-16 过期），私钥、CSR、证书、p12 和 p12 密码在本机 `~/.appstoreconnect/ci-dev-cert/`（600，不进仓库）。到期前在那里用同一把私钥重新出 CSR、`POST /v1/certificates` 建 DEVELOPMENT 证书、重新导出 p12，覆盖上面两个 secret。桌面 mac 的 `APPLE_CERTIFICATE` 系列是 Developer ID，别混用。这个账号开发证书的上限是 10 张；以后再满，用 ASC API 列 `/v1/certificates`，吊销名字是 `Apple Development: Created via API`、过期时间最早的那几张（不要动 RPPZGVPQB8）。吊销开发证书会让用它签的已装 app 打不开，被吊的那几次构建要重装。
