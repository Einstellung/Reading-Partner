# TestFlight 上传成功不等于测试者能装到，build 还得被 link 到 beta 组

现象：`iOS TestFlight` workflow 全绿，`xcrun altool --upload-app` 报上传成功（run 31376187351 传的是 0.8.22），App Store Connect 里也能看到这个 build，但 iPad 和 iPhone 的 TestFlight 里一直停在 0.8.21，等多久都不出现。没有任何一步报错，所以看日志看不出缺了什么。

原因：altool 只做 ingest。App Store Connect 收下包、处理到 `processingState: VALID` 之后就停在那里，build 和测试者之间的那条边要另外建——build 必须被加进某个 beta 组（`POST /v1/betaGroups/{id}/relationships/builds`）才对该组的测试者可见。内测组只有在组本身开了「自动分发新 build」（API 上是 `hasAccessToAllBuilds`）时才自动收，没开就得逐个 build 手动加；外测组还多两道：这个 build 要有 What's New 文本（`betaBuildLocalizations`），而且要提交并通过 beta 审核（`betaAppReviewSubmissions`）。上传成功和分发是两件事，workflow 只做了第一件。

解法：上传后跑 `scripts/testflight-distribute.py`（`.github/workflows/ios-testflight-distribute.yml`，构建 workflow 的 `distribute` job 也调它）。它等处理到 VALID，把 build 加进全部内测组和全部外测组，外测再补 What's New 和 beta 审核提交；每一步都幂等，同一个 build 重复跑不会出错。已经传上去没分发的包，手动跑那个 workflow 填 run number 就能救回来，不用重新构建。做法和限制见 `docs/11-iOS-TestFlight发布.md` 的分发一节。
