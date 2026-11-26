# 交接：删 info（Intel），保留三餐

分支 `chore/remove-info`，worktree `/home/xinyuan/Documents/Github/Reading-Partner/.claude/worktrees/agent-ab812ec081f1f2055`，基于 main `7bb6743c`。不推远端、不合 main。合并前删掉本文件。

worktree 里先 `bun install --frozen-lockfile`（坑 698，否则借主 checkout 的旧 node_modules，typecheck 报一串 durable 类型错）。

## 已做（每个都 t.sh 全绿、typecheck 过）

1. `955710ce` 纯搬家：`src/info/meals` → `src/meals`，`tests/info/meals` → `tests/meals`，`ui/components/info/meals` + `MealsDraftCard.tsx` + `MealsPrepCard.tsx` → `ui/components/meals`，`tests/ui/components/info/meals` → `tests/ui/components/meals`。LAYER 表、palace kinds 里的 `flow("src/meals/...")`、注释里的路径同步改。
2. `aea456ca` 纯搬家：`info/links` → `reading/ingest/links`；X 链接阅读器（`live/outbound/permalink/post/read-post/reader/snowflake/search-page`）→ `reading/ingest/x`；`info/sources/plugins` → `src/sources/plugins`，`read-page-tool/drive-site/plugin/descriptor/item` → `src/sources`。测试同步搬，`scripts/` 的 import 一并改。LAYER 登记 `reading/ingest/links`、`reading/ingest/x`、`sources`、`sources/plugins`（都是 domain）。
3. `9af337f8` 三餐对话的 anchor 和备菜语音通话进 `src/meals/conversation/`（`anchor.ts` 新写，`call.ts` 是 `briefer/meals-call.ts` 搬过来）。`briefer/anchors.ts` 暂时 re-export，删 briefer 时直接让调用方 import `meals/conversation/anchor`。

4. `8567ad90` A+B 的逻辑部分：三餐对话离开 briefer 和 InfoHome。
   - domain：`meals/conversation/role.ts`（角色 id `meals`，duty 只讲周计划、采购单、做法、备菜，不提简报、没有 tasking；tools/writes 为空，工具照旧挂在 meals desk item 上）、`durable.ts`（`mealsPlace`、`prepareMealsTurn`、`assembleMealsTurn`、`mealsAssemblies`、`watchMealsConversation`、`MEALS_CONVERSATION_KEY`/`MEALS_ADDRESS`/`MEALS_BOX_ORIGIN`）、`deliver.ts`（`layMealsTurn`、`registerMealsDelivery`）；`meals/today.ts` 出 `todayLocal`；`reading/turn/meals-bell.ts`（`registerMealsBell`：turn delivery、reply append、think desk 三样）。info-durable/info-turn/deliver/info-bell/anchors 里的三餐分支全删，`livePosition` 删。
   - UI：`ui/components/meals/` 新增 `use-meals-call.ts` + `MealsCall.tsx`（对话面板）、`MealsCards.tsx`（`MEALS_CARD_REGISTRY`，cardRegistry.ts 登记）、`use-meals-host.ts`（原 InfoHome 里三餐的全部状态：useMeals、备菜步骤与语音、本地日/菜谱/备菜、对话 anchor、overlay、首页 tile）+ `MealsHost.tsx`（三餐各屏和对话的渲染）、`host.ts`（`isMealsScreen`、`mealsStickKey`、`leaveForAppliedPlan`、`mealsCallPosition`、`topicFiledNote`，配 `tests/ui/components/meals/host.test.ts`）。InfoHome 只调 `useMealsHost` 并挂 `<MealsHost>`，手机首页 tile 走 `mealsHost.tile`/`runAction`。
   - 盘上的值都没变：`info-meals`、`meals`、`meals:meals`、`{place:"meals"}`、caller `meals-chat`；遥测 surface 和 thread kind 仍写 `"info"`（日志和文件里本来就是这个值，故意保留）。
   - tasking 测试组已删（`meals-think.test.ts` 的 tasking 那条、`writable-replay.test.ts` 的 "the tasking worker"，后者换成只验三个 meals writable 登记）。
   - `grep -rnE "from ['\"][^'\"]*(/info/|components/info)" src/meals src/ui/components/meals src/reading/turn/meals-bell.ts tests/meals tests/ui/components/meals` 无结果。

5. `c5fb804d` 文案：三餐的 `info.anchor.meals*`（含漏列的 `mealsLeftToBuy`）、`info.ask.*`、`info.errors.{noProvider,extractorFailed}` 复制成 `meals.anchor.{kickoff,title,placeholder,noPlan,thisWeek,leftToBuy}`、`meals.ask.*`、`meals.errors.*`，9 种语言值不变；`topicFiledNote` 搬到 `ui/components/chat/call/topic-filed.ts`，键改 `chat.call.note.topicFiled`，门口和三餐共用；门口的 `info.errors.noProvider` 改 `chat.errors.noProvider`。info 目录里的原键还在，随 info 目录删。
6. `1171973a` 测试：三餐那半复制出来，断言不变。`tests/meals/conversation/{meals-durable,meals-kill,deliver}.test.ts` + `meals-kill-child.ts` + `support/meals-file.ts`；`tests/reading/turn/meals-bell.test.ts`（两条：落进常驻对话、开着时流进去可停）；`tests/ui/components/meals/meals-call-turn.test.ts`（后两个按 src 路径镜像放）。原文件里的三餐用例还在，随 `tests/info`、`tests/ui/components/info`、`info-bell.test.ts` 一起删；info-bell 的 "does not wait on a busy briefing conversation" 是拿简报作对照的，随简报删，不搬。
7. `7273f559` 挂载点：`App.tsx`、`PhoneApp.tsx` 自己调 `useMealsHost`、画 `<MealsHost>`（手机端带 day/recipe/prep/back/PullToAsk/pipCards=false），`PhoneHome` 的 `mealsTile`/`onMealsTile` 成了它自己的 props（不再走 `LaunchProps`）。InfoHome 不再碰三餐，`reachableScreen` 不再替三餐屏改道（三餐屏交给 MealsHost 的 `enabled`）。没在 xvfb 上点过。
8. 坑 699：在途回合的 place 重开时不再登记，打开不报错、不重问，半句静默丢掉。所以删 Intel 时 `useBackgroundServices` 的 `info: infoPlace()` 可以直接拿掉。
9. `aca3644f` Today 搬出 info：`Vestibule.tsx` → `ui/components/shelf/Vestibule.tsx`（简报卡和 `oldBriefing` 去掉，`CardBodyPlaceholder` 内联），`today.ts` 拆两半：`shelf/today.ts` 只留 `todayDateLine`/`continueMetaLine`，简报卡那几行留在 `ui/components/info/today.ts` 给 HomeCard 随 info 删。键 `info.vestibule.*`、`info.today.{pageOf,page,marks}` 复制成 `shell.vestibule.*`、`shell.today.*`（9 种语言）。`launch-placeholder.test.tsx` 搬到 `tests/ui/components/shelf/` 并改成直接渲染 Vestibule（简报占位那几条随简报删）。9322 pass / 1 skip / 0 fail。

搬家用的脚本在 `HANDOFF-remove-info-tools/`（合并前和本文件一起删）：`bun HANDOFF-remove-info-tools/mv.ts . moves.json`，moves.json 是 `[[旧路径, 新路径], …]`（文件或目录），按旧位置解析 src/tests/scripts 里每个相对 import、算新路径、再 `git mv`；`import.meta.dir` 拼的 fixture 路径、字符串和注释里的路径它不管，要手动 grep。`bun HANDOFF-remove-info-tools/deps.ts . report` 列出谁还 import info（谓词写死了 `src/info/`，按需改）。

## 第六棒（2026-11-25）：删除已提交

- `92437d84` 删除 commit（step5 补丁 + 本棒修绿）。7964 pass / 1 skip / 0 fail，typecheck RC=0。`HANDOFF-remove-info-tools/step4`、`step5` 的补丁已落进这个 commit，不用再打。
  - `info-thread` 行保留且留着 `distill`（`tests/memory/distill-sources.test.ts` 拿它注册假 source）；registry.test 的 `distilledMessages` 列表含它，SOURCED 不含（没人注册它的 source），注释写了原因。
  - 同步测试的夹具换成仍在的行：`info-feedback.jsonl` → `memory-usage-d1.jsonl`（LINES）/ `legion/ledger/…jsonl`（never-infer），`info-pool-marks.json` → `info-meals-dishes.json`（带 wrapper 的 map），`info-sources.json` → `saved-articles.json`（顶层数组），opaque 的 `info-ask`/`info-briefing`/`info-bodies` → `legion/claim/…`。range.test 把已删行的文件挪进 out-of-range 那条，钉住「出 sync range、盘上原样留着」。
  - 删 `src/memory/profile/feedback.ts` + 测试（只剩测试在用）；settings 的 `tab.accounts`、`account.{briefing,screening,analysis,briefingHint}` 9 种语言删掉。
  - chat-scale-contract：「手机那条 CallView 不缩放」原来盯 InfoCall，改盯 `meals/MealsCall.tsx`；info-refusal.test 改名 `meals-refusal.test.ts`，盯 `use-meals-call.ts`；use-companion-name 删 `info.shelf.empty` 和简报封面那条。
  - `cover-svg.ts` 删 `issueCover`/`studyCover`/`volumeCover`（调用方全在 info 里，`volumeCover` 用的键已删），只留稿的 `typographicCover`；color-tokens 里 cover-svg 那条放行一并删。
  - LAYER 表删 19 个已删目录和 `info` 行，相关注释改掉。
- `03698f1f` 手机 nav-stack 删 `briefing`/`briefs`/`article`/`saved`/`savedArticle`，PhoneApp 不再画 SavedArticleView，`shell.savedArticle.backLabel` 删。栈只在内存里，没有要迁移的。

### 还剩（第 5 项残留，没做）

- `companion/issue-context.ts` + `tests/ui/components/companion/issue-context.test.ts`、`tests/soul/door-issue.test.ts`；调用方 App、PhoneReader、use-door-chat、DoorChat、CompanionCorner。
- App 的 `readerMode === "issue"`、`reading/issue*.ts`、`box-jump` 的 `go-to-briefing` 步骤。
- `reading/saved/` 里只属于 Intel 的部分（LibraryScreen 和链接收藏用的 saved-articles 留着；`saved-article-tools` 还挂在 durable catalog 上，要先看谁用）。
- `library.ts` 的 `issue` 类型保留、书架过滤（盘上旧数据读到时忽略，不写迁移）。
- `workshop/bindery` 的 `typographicCover`/`build-article` 现在 src 里没有调用方（只剩测试），是不是 Intel 专用要看 docs/67 再定。
- 注释和文案里的 `info/` 路径：`grep -rnE "info/" src tests scripts | grep -v docs/info/` 44 行、38 个文件；import 已是 0。
- Experiments 开关（D 段）照旧没做。

## 第五棒（2026-11-25）：停在 `HANDOFF-remove-info-tools/step5/`，取代下面 step4 那份

step5 = step4 补丁 + 第五棒的修改。分支仍停在上一个 commit，代码没有新 commit（不绿）。worktree 里可能还留着打好补丁的未提交状态（auto mode 拦了 `git restore`），先 `git status` 看：干净的话

```
xargs -a HANDOFF-remove-info-tools/step5/step5-deleted.txt git rm -q
git apply HANDOFF-remove-info-tools/step5/step5.patch
git add src/ui/components/chat/TopicProposalCard.tsx
```

打上后 `bun run typecheck` 两个项目都过（RC=0）。全量 `scripts/t.sh` 跑过一次（在恢复 info-thread 行之前）：7943 pass / 29 fail。

第五棒做了：交接第 1-4 项全部（registry、pull-coverage、tool-contract、think-kind、sources 四个、structured-output、chatParts、scroll-restore-contract 的类型错；experiment-gates、shell-nav、shell-places、phone-home-render 按新签名重写，三餐用例保留，PhoneHome 原 Intel 位置换成 Meals tile）；另修了 app-sidebar-render（Briefing 行换成 Meals 行）、door-tools（删 Intel 开关那条）、meals/host、card-registry-context（spy 对象从 InfoHome 换成 `MealsHost` 命名导出，两个壳都挂它）、derived（删 `info/labs`、`ui/components/info/saveArticle.ts` 两项）。chatParts 里上一棒删掉的通用协议用例（latestCardOf、patchCardPayload、round-trip、reopen）用 topic-proposal 卡恢复了。registry 里上一棒删掉的「desk 行都有 opener」守卫恢复了（去掉 registerInfoDesk）。

palace kinds：删了 29 个 Intel 行（info-feedback、info-sources、info-labs、topic-search 全家、info-shelf、info-issue-spoken、info-picture、info-cables、info-briefing/bodies-published、info-pool-*、info-ask、info-daily-*、info-site-sessions、info-source-health、info-issue-state、topic-search-runs、topic-search-graph-cache）。retention-guard 读 flow 文件，这些行的 flow 指向已删的 `src/info/...`，不删就红，所以必须进删除 commit。行删了以后文件出 sync range：本地扫描（syncFs.ts:148）和远端列表（driveBackend.ts:584）都按 inSyncRange 过滤，reconcile 两边都看不见，不会推断删除（`HOLDINGS_INFER_DELETIONS = false`），盘上的文件原样留着。`info-thread` 行保留（about 改成「Intel 删除前的简报对话」，去掉指向 info-briefing-published 的 ref）：conversations/search、topic-of、messages-engine、soul/catalogue、distill-sources 十几条测试拿 `threads-info-<date>.json` 当对话夹具，留着它旧简报对话还能被搜到。要不要删交主会话定；删的话这些夹具要换成 `threads-<bookId>.json`，`delete-topic.ts` 的 `"info-thread"` handler 一起删。

还红的（恢复 info-thread 后单跑这几组，10 fail）：
- `tests/palace/registry.test.ts`：`under("distilledMessages")` 列表把 `"info-thread"` 加回去（第五棒先删后恢复了行，测试没跟着改回），SOURCED 也加回 `"info-thread"`，`booted()` 里没有 info 的 distill source 了，SOURCED 那条要么去掉 info-thread、要么在 info-thread 行上去掉 `distill`（没人注册它的 source）。
- 同步测试拿已删行当夹具：「a feedback log that lost lines…」「the feedback log unions its lines…」（info-feedback）、「pool marks merge per item…」（info-pool-marks）、「the source list merges per source」（info-sources）、「core user-data files are in range」「the files the app writes are classified…」「the never-infer list is never inferred」。用 `grep -rln "info-feedback\|info-pool-marks\|info-sources\|info-labs" tests` 找；换成仍在的同类行（LINES+records 用 `memory-usage-` 或 legion ledger，records 用 `info-meals-dishes` 等），或删掉只为 Intel 写的那条。`src/memory/profile/feedback.ts` 只剩测试在用，可一起删。
- `tests/i18n/settings-render.test.tsx:35` 期待 "Account"：Accounts 页删了，tab 现在是 "AI & sync / Features / Optional / Experiments"，断言换成别的 tab 名。
- `tests/ui/components/chat-scale-contract.test.ts` 两条，没看。
- 修完再跑全量；layering 表没报错，可能还要看。

## 原第 4 步说明（step4 已被 step5 取代，下面的「接着要修的」第五棒已做完的不再重复）

第四棒在工作区里把 src 侧改到 `bun run typecheck` 的 src 项目全过，tests 项目还有十几个文件没修完，没跑过 `scripts/t.sh`。不留红 commit，所以整包存成补丁，分支停在 `aca3644f`。接着做：

```
cd <worktree>
xargs -a HANDOFF-remove-info-tools/step4/step4-deleted.txt git rm -rq
git apply HANDOFF-remove-info-tools/step4/step4.patch
git add src/ui/components/chat/TopicProposalCard.tsx
```

（原 WIP commit `c81884a6` 只在 reflog 里，补丁是它减去下面四个测试文件。）

### 补丁里已做的

- `git rm`（348 个文件，清单在 `step4-deleted.txt`）：`src/info`、`src/ui/components/info`、`src/i18n/messages/info`、`tests/info`、`tests/ui/components/info`、`reading/turn/info-bell.ts`+测试、`smoke/orb-spike-harness.tsx`（VoiceOrbEntry 在 info 目录里一起没了）、companion 的 `TopicSearchCard`/`Study{Lines,Move,Seeds}Card`/`IssueQuestionCard`/`issue-call`/`study-end`/`use-study-run`/`voice-context`/`voice-call-mode`、`ui/components/reader/study/`、`phone/home-intel.ts`、`phone/SavedList.tsx`、`settings/AccountsPanel.tsx`+`use-accounts.ts`、`scripts/topic-{expand-probe,labels-replay,search-data,search-live}.ts`、`scripts/x-reader-live.ts`（它驱动的是主题搜索的 X 搜索读取器 `topic-search/x-reader`，那个随 info 删了，留着没东西可跑；`x-browse-host.ts`、`x-search-probe.ts` 不 import info，没动），以及这些文件的测试。
- 运行期摘线：`useShellBootstrap` 去掉 distill source、tasking、briefing/info delivery、collect worker、topic search runs、info desk、secretary role、两个 info garbage marker；`useBackgroundServices` 去掉 `info: infoPlace()`；`dev-faux` 去掉 `infoAssemblies`；`i18n/areas.ts` 去掉 info。
- 壳：App 直接画 `<Vestibule>`（`homeScreen === "vestibule"` 时，套原 InfoHome 的 `absolute inset-0 overflow-y-auto` 容器），去掉 InfoShelf、`openIssueBook`、`refreshInfoCollector`、study reader；`goToBriefing` 落 Today。PhoneApp 在 `base.kind === "home"` 时直接画 `<PhoneHome>`，去掉 InfoHome、InfoShelf、收藏列表和 saved-articles 的读取/同步路由；`infoScreenFor` 改名 `homeScreenFor`。PhoneHome 去掉 Intel 封面、收藏 tile、旧简报卡和 `LaunchProps`，原 Intel 那一节换成 Meals tile（`meals` 开时），新 prop `onOpenSettings`。`use-home-data` 只剩 `useReadingProgress`。PhoneReader 去掉 study。
- 导航：`shell-nav` 的 `HomeScreen` 去掉 `briefing`/`briefs`/`article`，`ShellNavId` 去掉 `briefing`/`briefs`，`reachableScreen(screen, shown)` 改成两参，`hiddenByExperiments` 只看 meals，`showsLaunchCard` 删；`places.ts` 去掉 `briefing` 和设置说明里的「(X, Bloomberg)」；`AppSidebar` 去掉 Briefing/Briefs 两格和 `briefs`/`oldBriefing` props（桌面 Meals 那格原本就在，`gates.meals` 控制）。
- 卡片：`CardPayload` 去掉 `InfoCard`/`TopicSearchCard`/`IssueQuestionCard`，直接列 `MealsCard`、`TopicProposalCardData`；`ThreadMessage.card` 旧字段删；topic-proposal 卡（门口和三餐都用）从 InfoCards 搬成 `ui/components/chat/TopicProposalCard.tsx`，键 `info.cards.*` 那 6 个复制成 `chat.topicCard.*`；`card-gates` 去掉 `INTEL_CARD_KINDS`，`hiddenCardKinds` 只看 meals；`box-jump` 的 `shownBoxItems` 只看 meals，盘上剩的 `brief-issue` 盒子项一律不画。
- companion：`use-door-chat` 去掉主题搜索、study、issue 问题卡、issue 开场（`openedFor`）、`loadTopicSearchGuidance`；`door-tools` 去掉 topic-search 工具和 `intel` 开关；`use-voice-call` 只建门口通话（`createDoorVoiceCall`，不带 issue material）；`CompanionCorner` 去掉 voice context 和 `markIssueTold`。
- `durable-catalog` 去掉 source/companion/tasking/topic-search 工具。
- Settings：Accounts 页整页删（`BASE_TABS` 去掉 `accounts`）。那页只有站点登录（X、Bloomberg，`accountRows` 全由 Intel 的源推出）；app 自己的账号/设备登记（docs/north-star/accounts.md）没有 UI 在这页里，代码没动。`AccountPanel` 去掉旧简报的 Screening/Analysis 段。
- 测试：domain-markers、retention-guard、palace/registry、saved-articles、think-kind、tool-contract、sources 五个、structured-output、chatParts、scroll-restore-contract 剪掉了 Intel 的用例和 import，但还没编过（见下）。

### 接着要修的（`bun run typecheck` 的 tests 项目报的）

- `tests/palace/registry.test.ts`：第 28 行还在引 `registerInfoDistillSource`，几个 import 变成未用。
- `tests/platform/sync/pull-coverage.test.ts`：`ASK_PULL_ROUTE`/`READER_PULL_ROUTE`/`SOURCES_PULL_ROUTE` 三个 import 没剪；剪完看覆盖断言要不要同步改（palace kinds 里 info 的 kind 还在）。
- `tests/soul/tool-contract.test.ts`：第 246 行 `const companion = buildCompanionTools(...)` 和用它的那条测试要删。
- `tests/soul/think-kind.test.ts`、`tests/sources/plugins/{arxiv,github,huggingface,s2}.test.ts`、`tests/structured-output.test.ts`：剩下未用的 import。
- 这四个没进补丁，还是 `aca3644f` 的原样，要手改：`tests/ui/components/base/{experiment-gates,shell-nav,shell-places}.test.ts`、`tests/ui/components/phone/phone-home-render.test.tsx`。按上面的新签名改（`reachableScreen` 两参、没有 briefing/briefs、`shellNavItems({ meals })`、PhoneHome 新 props），只删 Intel 的断言，三餐和其余的留着（第四棒用关键词批量剪，把三餐的也剪了，所以退回原样）。
- 之后跑 `scripts/t.sh`：`tests/layering.test.ts` 的 LAYER 表要去掉已删目录（`info` 各子目录、`ui/components/info`、`ui/components/reader/study` 等）；其余运行期失败未知。
- 可能还有 src 里指向已删模块的测试，比如 `tests/ui/components/companion/{door-tools,voice-call-handle,box-jump}.test.ts`、`tests/soul/companion-intro.test.ts`、`tests/ui/components/phone/phone-nav-stack.test.ts`，typecheck 过了再看运行结果。
- commit 建议拆两个：先逻辑改动（补丁），再 `git rm`。分不开就一个 commit，message 里写清。

### 补丁之外、这一棒没碰的 Intel 残留（不 import info，能编过）

- `phone/nav-stack.ts` 的 `briefing`/`briefs`/`article`/`saved`/`savedArticle` 栈项；PhoneApp 还画 `savedArticle`（已无入口）。
- `companion/issue-context.ts`（打开的简报、Ask 一段简报）、`box-jump` 的 `go-to-briefing` 步骤、App 的 `readerMode === "issue"`、`reading/issue*.ts`、`reading/saved/`（只删了收藏页，`saved-article-tools` 还挂在 durable catalog 上）。
- 原清单里的其余项照旧：`src/sources` 的 index provider、`reading/ingest/x/search-page.ts`、soul/memory/legion/workshop 里只给 Intel 的代码、`palace/kinds.ts` 的 info kind、`scripts/x-search-probe.ts`/`x-browse-host.ts`、`workshop/bindery/cover-svg.ts` 里 `info.issue.book.volumeCount`（键已随 info 目录删，要换成别的或删 `volumeCover`）。
- 注释里指向已删模块的话还没清（`grep -rn "info/" src tests scripts`）。

### D. Experiments（没做）

- `platform/experiments/registry.ts`：删 `intel`，`meals` 去掉 parent；迁移：旧 map 有 `intel` 键时 meals 取 `meals && intel`，一次写回。
- `ExperimentsPanel.tsx`（子项、"Turn on Intel first"）、`base/experiment-gates.ts`、`common/use-experiment.ts`，`settings.experiments.intel.*` 和 meals summary 的 9 种语言。补丁里 `gates.intel` 已经没有读的地方了（除 experiments 自己）。

## 要报给主会话的

- 项目 `CLAUDE.md` 那句「每个库一个插件文件在 `info/sources/plugins/`」已过期，现在是 `src/sources/plugins/`；没动 CLAUDE.md。
- 坑：698、699 已用；700、701 预分给这条线，第六棒没踩到新坑，仍未用。
- 没在 xvfb 上点过界面。
