# 602 开发证书满额，云签名的 .dev 包和 WDA 一起编不出来

现象：2026-10-14 `ios-linux-loop.yml` 在 hv/harness（run 38555148709）和 hv/integrate（run 38558162574）上连续失败，代码没问题。`wda` 和 `devbuild` 两个 job 都报 `Choose a certificate to revoke. Your account has reached the maximum number of certificates`，接着 `No profiles for 'com.xinyuan.readingpartner.dev' were found`（WDA 是 `com.xinyuan.wda.xctrunner`）。10-12 之前同一 workflow 一直绿。

原因：CI 走 ASC API key 加 `-allowProvisioningUpdates`，runner 是全新的钥匙串，每次都让 Apple 新建一张 Apple Development 证书。账号的开发证书有上限，满了以后 Xcode 不会自己吊销旧的，签名直接失败，profile 也就建不出来。

解法：账号持有人到 developer.apple.com 的 Certificates 页吊销 CI 留下的旧 Apple Development 证书，再重跑 `gh workflow run ios-linux-loop.yml --ref <分支>`。要根治得让 CI 复用同一张证书（证书和私钥存成 secret 导入钥匙串），而不是每次新建。
