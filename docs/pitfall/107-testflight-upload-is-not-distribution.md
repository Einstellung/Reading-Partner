# TestFlight 上传成功不等于测试者能装到，build 还得被 link 到 beta 组

现象：`iOS TestFlight` workflow 全绿，`xcrun altool --upload-app` 报上传成功（run 31376187351 传的是 0.8.22），App Store Connect 里也能看到这个 build，但 iPad 和 iPhone 的 TestFlight 里一直停在 0.8.21，等多久都不出现。没有任何一步报错，所以看日志看不出缺了什么。

原因：altool 只做 ingest。App Store Connect 收下包、处理到 `processingState: VALID` 之后就停在那里，build 和测试者之间的那条边要另外建——build 必须被加进某个 beta 组才对该组的测试者可见。内测组只有在组本身开了「自动分发新 build」（API 上是 `hasAccessToAllBuilds`）时才自动收，没开就得逐个 build 手动加；外测组还多两道：这个 build 要有 What's New 文本（`betaBuildLocalizations`），而且要提交并通过 beta 审核（`betaAppReviewSubmissions`）。上传成功和分发是两件事，workflow 只做了第一件。

解法：上传后跑 `scripts/testflight-distribute.py`（`.github/workflows/ios-testflight-distribute.yml`，构建 workflow 的 `distribute` job 也调它）。它等 build 出现、等处理到 VALID，把 build 加进全部内测组和全部外测组，外测再补 What's New 和 beta 审核提交；每一步都幂等，同一个 build 重复跑不会出错。已经传上去没分发的包，手动跑那个 workflow 填 run number 就能救回来，不用重新构建。做法和限制见 `docs/11-iOS-TestFlight发布.md` 的分发一节。

## 上传返回不等于 build 已经存在，等待是两段

run 31455103859：build job 上传成功，distribute job 紧接着起来，几秒内就挂了：

```
App: Reading Partner APP (com.xinyuan.readingpartner) id=6794613369
##[error]no build with CFBundleVersion 43 under this app.
```

原因：`xcrun altool --upload-app` 返回只代表字节传完，Apple 侧的 ingestion 还要几分钟才把 build 资源建出来。在这中间 `GET /v1/builds?filter[version]=43` 返回空数组——不是「这个 build 状态还没好」，是「这个 build 还不存在」，所以没有任何状态可以轮询。脚本原来只有等 `processingState` 变 `VALID` 那一段循环，那是找到 build 之后的事；找不到直接判死。

解法：找 build 自己一段轮询（`wait_for_build`，默认 20 分钟、30 秒一轮），它结束的地方才是等 VALID 那段（默认 40 分钟）的开始。两段的日志要能区分：一段打 `build 43 is not in App Store Connect yet`，另一段打 `processing state PROCESSING`。两段都走 `Client.request`，JWT 快到期时自己续签，所以等多久都不用额外处理。超时的报错说的是「别重新构建，去 Actions 手动跑 iOS TestFlight Distribute 填这个 build 号」——ipa 已经传上去了，重新构建只会换个新号。

不带 build 号取「最新那个」不能等，而且比报错更坏：ingestion 期间 API 能看到的最新 build 正是被替换掉的上一个，分发它等于给所有测试者推旧版本还报成功。所以 build 号是必填的（两个 workflow 的 input 都 `required: true`，构建 workflow 一直传 `github.run_number`），脚本另留 `--newest` 给手动场景显式声明「现在没有上传在跑」。

## 加外测组时 Apple 说这个 build 不存在

第一次真跑（run 31390099873）内测那半成了，外测在加组那一步挂掉：

```
POST /v1/betaGroups/6622ced0-.../relationships/builds -> HTTP 404
[NOT_FOUND] There is no resource of type 'builds' with id 'bf9e1c3b-...'
```

这个 build id 是几秒前 `GET /v1/builds` 自己返回的，`processingState` 是 `VALID`。404 点名的是 build 不是 group，说明 group id 解析成功、build id 没解析成功——Apple 是在一个比「这个 app 的全部 build」更窄的范围里找这个 build。已知有三件事能让一个 VALID 的 build 掉出外测组的可见范围：

- `buildAudienceType` 是 `INTERNAL_ONLY`。Xcode 可以导出只给内测的 ipa，这种包外测组永远收不了（Apple 的原话是 "Only internal tester groups can include builds marked as internal"，见 [add-testers-to-builds](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-testers-to-builds)）。重试没用，得重新导出。
- `buildBetaDetail.externalBuildState`。`processingState: VALID` 只是内测就绪信号，外测有独立的状态机而且落后于它；`MISSING_EXPORT_COMPLIANCE` 会把 build 一直停在那里等人回答加密问题。
- Apple 自己抽风。公开报告里唯一一例同样的报错同样的端点（[forums/thread/762624](https://developer.apple.com/forums/thread/762624)）是几小时后自己好了，调用方什么都没改。

还有一层是端点选错了方向。这条边有两个方向的端点，文档上等价：`POST /v1/betaGroups/{id}/relationships/builds` 和 `POST /v1/builds/{id}/relationships/betaGroups`。fastlane 的 spaceship 只用后者（`Build#add_beta_groups` → `add_beta_groups_to_build`，[testflight.rb](https://github.com/fastlane/fastlane/blob/master/spaceship/lib/spaceship/connect_api/testflight/testflight.rb)），从来不调前者——挂掉的那次调的正是前者。

顺序也是反的。fastlane 的 `distribute_build` 是「补 export compliance → 提交 beta 审核 → 加组」，提交审核排在加组前面（[build_manager.rb](https://github.com/fastlane/fastlane/blob/master/pilot/lib/pilot/build_manager.rb)）。先提交还失败得更体面：审核中但没进组，在 App Store Connect 里点一下就补上了；进了组但从没提交过，build 会一直停在 "Ready to Submit"，谁也收不到而且不报错（[forums/thread/693864](https://developer.apple.com/forums/thread/693864)）。

解法（脚本现在的做法）：外测那半按「查 `buildAudienceType` → 等 `externalBuildState` 稳定 → 写 What's New → 提交 beta 审核 → 加组」走；加组先调 builds 那一侧的端点，只在它失败时把 betaGroups 那一侧当一次 fallback，两边的 HTTP 状态和 Apple 原话都打出来。内测和外测互不牵连，结尾统一打小结，有任何一步没做成退出码非零。

## 日志里营销版本号是 `?`

同一次 run 里 build 那行打成 `Build: ? (42)`，What's New 也退化成 `Build 42.` 而不是 `Reading Partner 0.8.22, build 42.`。

原因：`fields[builds]` 是 sparse fieldset，管的不只是 attributes，也管 relationships——没列进去的 relationship 整个不会出现在响应里。当时 `fields[builds]` 只列了 `version,uploadedDate,processingState,expired,usesNonExemptEncryption`，于是 `include=preReleaseVersion` 拿回来的 included 数组没有对应的 relationship id 可以配，营销版本号取不出来，What's New 跟着退化。

解法：把要读的 relationship 名字也写进 `fields[builds]`（`preReleaseVersion`、`buildBetaDetail`、`buildAudienceType` 都是 [get-v1-builds](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds) 文档里的合法取值）。取 included 资源统一走 `pick_included()`：按 relationship 的 id 配，配不上且 included 里恰好只有一个该类型资源时才退而取它；仍取不到就单独 `GET /v1/builds/{id}/preReleaseVersion`。

## distribute job 红了不代表包没到手：外测审核提交有当天频次上限

run 32952493149（0.11.11 / build 65）：build job 绿，distribute job 红，退出码 1。但日志里内测那半是成功的：

```
Internal testing:
  'Internal': already has the build (already in the group)
External testing:
  external build state READY_FOR_BETA_SUBMISSION
  What's New updated ('Reading Partner 0.11.11, build 65.')
  stopped at: submitting the build for beta review
##[error]submitting the build for beta review: POST /v1/betaAppReviewSubmissions -> HTTP 422
[ENTITY_UNPROCESSABLE.SUBMISSION_LIMIT_REACHED] Submission limit has been reached.
```

原因：Apple 对外测 beta 审核提交有当天频次上限。这天已经连着发了 61、62、63、64，第五次撞上。内测不受这个限制，build 早就进组了，装得到。

脚本在这个 422 下打的提示是「去 App Store Connect 填 Test Information」，那是挂在 422 上的通用提示，和 SUBMISSION_LIMIT_REACHED 无关，照着做没有用。

解法：不重新构建。只有内测测试者时直接忽略，红的只是外测那条路。要补外测就等次日手动跑 `iOS TestFlight Distribute` 填这个 build 号，脚本幂等，会跳过已经做完的内测那半。
