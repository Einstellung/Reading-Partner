# 交接：删 info（Intel），保留三餐

分支 `chore/remove-info`，worktree `/home/xinyuan/Documents/Github/Reading-Partner/.claude/worktrees/agent-ab812ec081f1f2055`，基于 main `7bb6743c`。不推远端、不合 main。合并前删掉本文件。

worktree 里先 `bun install --frozen-lockfile`（坑 698，否则借主 checkout 的旧 node_modules，typecheck 报一串 durable 类型错）。

## 已做（每个都 t.sh 全绿、typecheck 过；8567ad90 时 9313 tests / 0 fail）

1. `955710ce` 纯搬家：`src/info/meals` → `src/meals`，`tests/info/meals` → `tests/meals`，`ui/components/info/meals` + `MealsDraftCard.tsx` + `MealsPrepCard.tsx` → `ui/components/meals`，`tests/ui/components/info/meals` → `tests/ui/components/meals`。LAYER 表、palace kinds 里的 `flow("src/meals/...")`、注释里的路径同步改。
2. `aea456ca` 纯搬家：`info/links` → `reading/ingest/links`；X 链接阅读器（`live/outbound/permalink/post/read-post/reader/snowflake/search-page`）→ `reading/ingest/x`；`info/sources/plugins` → `src/sources/plugins`，`read-page-tool/drive-site/plugin/descriptor/item` → `src/sources`。测试同步搬，`scripts/` 的 import 一并改。LAYER 登记 `reading/ingest/links`、`reading/ingest/x`、`sources`、`sources/plugins`（都是 domain）。
3. `9af337f8` 三餐对话的 anchor 和备菜语音通话进 `src/meals/conversation/`（`anchor.ts` 新写，`call.ts` 是 `briefer/meals-call.ts` 搬过来）。`briefer/anchors.ts` 暂时 re-export，删 briefer 时直接让调用方 import `meals/conversation/anchor`。

4. `8567ad90` A+B 的逻辑部分：三餐对话离开 briefer 和 InfoHome。
   - domain：`meals/conversation/role.ts`（角色 id `meals`，duty 只讲周计划、采购单、做法、备菜，不提简报、没有 tasking；tools/writes 为空，工具照旧挂在 meals desk item 上）、`durable.ts`（`mealsPlace`、`prepareMealsTurn`、`assembleMealsTurn`、`mealsAssemblies`、`watchMealsConversation`、`MEALS_CONVERSATION_KEY`/`MEALS_ADDRESS`/`MEALS_BOX_ORIGIN`）、`deliver.ts`（`layMealsTurn`、`registerMealsDelivery`）；`meals/today.ts` 出 `todayLocal`；`reading/turn/meals-bell.ts`（`registerMealsBell`：turn delivery、reply append、think desk 三样）。info-durable/info-turn/deliver/info-bell/anchors 里的三餐分支全删，`livePosition` 删。
   - UI：`ui/components/meals/` 新增 `use-meals-call.ts` + `MealsCall.tsx`（对话面板）、`MealsCards.tsx`（`MEALS_CARD_REGISTRY`，cardRegistry.ts 登记）、`use-meals-host.ts`（原 InfoHome 里三餐的全部状态：useMeals、备菜步骤与语音、本地日/菜谱/备菜、对话 anchor、overlay、首页 tile）+ `MealsHost.tsx`（三餐各屏和对话的渲染）、`host.ts`（`isMealsScreen`、`mealsStickKey`、`leaveForAppliedPlan`、`mealsCallPosition`、`topicFiledNote`，配 `tests/ui/components/meals/host.test.ts`）。InfoHome 只调 `useMealsHost` 并挂 `<MealsHost>`，手机首页 tile 走 `mealsHost.tile`/`runAction`。
   - 盘上的值都没变：`info-meals`、`meals`、`meals:meals`、`{place:"meals"}`、caller `meals-chat`；遥测 surface 和 thread kind 仍写 `"info"`（日志和文件里本来就是这个值，故意保留）。
   - tasking 测试组已删（`meals-think.test.ts` 的 tasking 那条、`writable-replay.test.ts` 的 "the tasking worker"，后者换成只验三个 meals writable 登记）。
   - `grep -rnE "from ['\"][^'\"]*(/info/|components/info)" src/meals src/ui/components/meals src/reading/turn/meals-bell.ts tests/meals tests/ui/components/meals` 无结果。

搬家用的脚本在 `HANDOFF-remove-info-tools/`（合并前和本文件一起删）：`bun HANDOFF-remove-info-tools/mv.ts . moves.json`，moves.json 是 `[[旧路径, 新路径], …]`（文件或目录），按旧位置解析 src/tests/scripts 里每个相对 import、算新路径、再 `git mv`；`import.meta.dir` 拼的 fixture 路径、字符串和注释里的路径它不管，要手动 grep。`bun HANDOFF-remove-info-tools/deps.ts . report` 列出谁还 import info（谓词写死了 `src/info/`，按需改）。

## 还剩

顺序建议 A → B → C → D，A+B 是一件事，最好一个 agent 做完。

### A+B 剩下的（下一棒先做，再做 C）

- i18n：三餐代码里还有 14 处 `t("info.…")`：`meals/conversation/anchor.ts` 的 `info.anchor.meals*`，`MealsHost.tsx` 的 `info.ask.about{Meals,Numbers,Shopping,Today,Weekday,Plan}`，`meals/conversation/durable.ts` 的 `info.errors.noProvider`/`extractorFailed`，`ui/components/meals/host.ts` 的 `info.call.note.topicFiled`（door 也用这个键，C 时它也得有新家）。搬进 `i18n/messages/meals`，9 种语言一起，`grep -rn 't("info\.' src/meals src/ui/components/meals` 归零。这是纯文案搬家，单独 commit。
- 测试：`tests/info` 里还夹着三餐那半，删 tests/info 前先剪进 `tests/meals/conversation/`：`info-durable.test.ts`（PLACES 循环的 meals 项、key/address 那条）、`info-kill.test.ts` + `info-kill-child.ts` + `support/info-file.ts`（`KILL_ORIGINS.meals`、`keyOf`/`addressOf`）、`deliver.test.ts`（meals delivery 那条）、`tests/ui/components/info/info-call-turn.test.ts`（"a meals turn lands in the meals conversation" 已改走 `useMealsCall`）。`tests/reading/turn/info-bell.test.ts` 里两条 meals bell 测试已改走 `deliverMealsBell`，删简报 bell 时搬成 `meals-bell.test.ts`。
- 挂载点：InfoHome 删掉时，`App.tsx` / `PhoneApp.tsx` 直接调 `useMealsHost` 并渲染 `<MealsHost>`（props 和 InfoHome 现在传的一样），`PhoneHome` 的 tile 改从 `useMealsHost` 的 `tile`/`runAction` 拿。hook 要挂在不随屏幕卸载的位置，备菜语音和对话才能跨屏活着。
- 没在 xvfb 上看过界面；只靠测试（meals-batch-cook、info-call-turn 的 meals 那条、host.test）。下一棒动挂载点时用 `xvfb-run` 点一遍三餐首页、Ask、草稿卡 Apply、备菜页。
- `InfoCallAnchor` 上的 `bookKey`/`kickoff` 字段只给过三餐用，随 C 删。

### B'. 入口（下一棒和 D 一起做）

- `AppSidebar.tsx`（桌面侧栏 Intel 那格换成 Meals）、`PhoneHome.tsx` + `phone/home-intel.ts`（手机首页 Intel 那格换成 Meals）、`base/places.ts`、`base/shell-nav.ts`（`HomeScreen` 的 `meals*` 屏、`reachableScreen`）、`phone/nav-stack.ts`。Meals 开关关着就不显示入口。

### C. 删 Intel

- 整个删：`src/info`（剩下的全部）、`src/ui/components/info`（B 做完后；先确认 `VoiceOrbEntry.tsx` 是不是只给简报用）、`tests/info`、`tests/ui/components/info`、`src/i18n/messages/info`（三餐键搬走后）。
- `src/sources`：`plugins/arxiv.ts`、`github.ts`、`huggingface.ts`、`s2.ts` 只留 site adapter（bindery 读这些站自己的链接要用）和 client，删 index provider；`all.ts` 只留 `registerSourceSiteAdapters`；`plugin.ts`、`descriptor.ts`、`item.ts` 剥完没人用就删。对应测试 `tests/sources/plugins/{arxiv,github,huggingface,s2}.test.ts`、`tests/sources/{plugin,descriptor}.test.ts` 跟着剪。`tests/reading/ingest/article.test.ts`、`tests/workshop/bindery/pdf.test.ts` 用 `arxivSiteAdapter`，要留。
- `reading/ingest/x/search-page.ts`：`permalink.ts` 只用它的 `spelledUrl`、`XLinkOut`，留这两个，搜索页解析删（`tests/info/x/search-page.test.ts` 和 fixtures 随 tests/info 删）。
- reading 里服务简报/主题搜索的：`issue.ts`、`issue-desk.ts`（简报书在阅读器里）、`saved/`（简报收藏）、`turn/door-think.ts`（把简报铺上桌）、`session/open-epub.ts`、`epub/reader-logic.ts`、`replace/carry-marks.ts`、`retell/cards.ts`、`prep/papers/live.ts`、`desk-tools.ts`，逐个 grep issue/brief/study 判断。`platform/app/library.ts` 的 `issue` 书目类型：盘上已有的 issue 条目不能让书架出错，留类型、过滤掉即可，拿不准就留。
- companion：`TopicSearchCard`、`Study*Card`、`IssueQuestionCard`、`issue-call`、`issue-context`、`study-end`、`use-study-run`、`box-jump`、`door-tools`（主题搜索工具）、`use-door-chat`（主题搜索、issue 开场、`briefer/call`）、`voice-call-mode`/`voice-context`/`use-voice-call`（简报语音）、`CompanionCorner`（issue box-state）、`intake-view`。
- `ui/components/reader/study/*`（主题搜索 study 阅读器）、`ReaderTopBar.tsx`、`reader-tool.ts`、`phone/reader/*`。
- `ui/components/chat/{chatParts,types,cardRegistryContext,quoted-question}.ts`、`cardRegistry.ts`、`card-gates.ts`。
- settings：`AccountsPanel.tsx` + `use-accounts.ts`（站点登录，全由 Intel 订阅的源推出来：Bloomberg、X 搜索登录）删；`AccountPanel.tsx`（old-briefing 开关）、`FeaturesPanel.tsx` 剪。`tests/ui/components/settings/accounts-panel.test.tsx` 删。
- `ui/components/common/durable-catalog.ts`（tasking/companion/source/topic-search 工具，`tests/soul/tool-contract.test.ts` 同步）。
- soul（`door.ts`、`turn.ts` 的主题搜索规则、`voice/live/*` 的 door-material 和简报通话）、memory（statements 里跟主题搜索联动的 concern follow、dream）、`legion/durable/program-task.ts`（info/program）、`workshop/bindery/cover-svg.ts`（study 封面）、`workshop/extract/webview-browse.ts`（X 搜索会话）：先确认只有 Intel 在用再删。
- `palace/kinds.ts`：写入方被删的 kind 一起删（主题搜索、labels、studies、issues、issue openings、攒着问、collect pool、rank、x progress、graph cache、briefings、sources 等）；`tests/palace/registry.test.ts`、`tests/platform/sync/pull-coverage.test.ts`、`tests/housekeeper/{domain-markers,retention-guard}.test.ts` 同步。不写迁移删用户文件。
- `smoke/orb-spike-harness.tsx`、`dev-faux.ts`、`tests/structured-output.test.ts`（用 analysis/synthesis、cable/types）、`tests/soul/think-kind.test.ts`、`tests/ui/components/common/scroll-restore-contract.test.ts`、`tests/ui/components/base/experiment-gates.test.ts`、`tests/ui/components/chat/chatParts.test.ts`、`tests/ui/components/companion/{study-end,voice-call-mode}.test.ts`。
- `scripts/topic-search-live.ts` 删；`x-reader-live.ts`、`link-intake-compare*` 留。
- `i18n/messages/sources`：看还有谁用。
- 删完 `grep -rn "info/" src tests scripts` 清注释里指向已删模块的话。

### D. Experiments

- `platform/experiments/registry.ts`：删 `intel`，`meals` 去掉 parent。保留旧值：旧 map 里 `intel` 和 `meals` 都是 true 的，升级后 meals 仍开；`intel` 关着、`meals` 存着 true 的，原来是 effectively off，按「保留用户已有的开关值」的字面意思，算法要先定一句再写（建议：旧 map 有 `intel` 键时 meals 的值取 `meals && intel`，一次写回）。
- `ui/components/settings/ExperimentsPanel.tsx`（子项、"Turn on Intel first"）、`base/experiment-gates.ts`、`common/use-experiment.ts`，以及 `settings.experiments.intel.*` 和 meals summary 的 9 种语言。

## 要报给主会话的

- 项目 `CLAUDE.md` 那句「每个库一个插件文件在 `info/sources/plugins/`」已过期，现在是 `src/sources/plugins/`；这次没动 CLAUDE.md。
- 坑：worktree 缺 node_modules 的那个已有 698，没新记。699、700 还没用。
