# 交接：删 info（Intel），保留三餐

分支 `chore/remove-info`，worktree `/home/xinyuan/Documents/Github/Reading-Partner/.claude/worktrees/agent-ab812ec081f1f2055`，基于 main `7bb6743c`。不推远端、不合 main。合并前删掉本文件。

worktree 里先 `bun install --frozen-lockfile`（坑 698，否则借主 checkout 的旧 node_modules，typecheck 报一串 durable 类型错）。

## 已做（每个都 t.sh 9312 pass / 0 fail，typecheck 过）

1. `955710ce` 纯搬家：`src/info/meals` → `src/meals`，`tests/info/meals` → `tests/meals`，`ui/components/info/meals` + `MealsDraftCard.tsx` + `MealsPrepCard.tsx` → `ui/components/meals`，`tests/ui/components/info/meals` → `tests/ui/components/meals`。LAYER 表、palace kinds 里的 `flow("src/meals/...")`、注释里的路径同步改。
2. `aea456ca` 纯搬家：`info/links` → `reading/ingest/links`；X 链接阅读器（`live/outbound/permalink/post/read-post/reader/snowflake/search-page`）→ `reading/ingest/x`；`info/sources/plugins` → `src/sources/plugins`，`read-page-tool/drive-site/plugin/descriptor/item` → `src/sources`。测试同步搬，`scripts/` 的 import 一并改。LAYER 登记 `reading/ingest/links`、`reading/ingest/x`、`sources`、`sources/plugins`（都是 domain）。
3. `9af337f8` 三餐对话的 anchor 和备菜语音通话进 `src/meals/conversation/`（`anchor.ts` 新写，`call.ts` 是 `briefer/meals-call.ts` 搬过来）。`briefer/anchors.ts` 暂时 re-export，删 briefer 时直接让调用方 import `meals/conversation/anchor`。

搬家用的脚本在 `HANDOFF-remove-info-tools/`（合并前和本文件一起删）：`bun HANDOFF-remove-info-tools/mv.ts . moves.json`，moves.json 是 `[[旧路径, 新路径], …]`（文件或目录），按旧位置解析 src/tests/scripts 里每个相对 import、算新路径、再 `git mv`；`import.meta.dir` 拼的 fixture 路径、字符串和注释里的路径它不管，要手动 grep。`bun HANDOFF-remove-info-tools/deps.ts . report` 列出谁还 import info（谓词写死了 `src/info/`，按需改）。

## 还剩

顺序建议 A → B → C → D，A+B 是一件事，最好一个 agent 做完。

### A. 三餐对话从 briefer 拆出来（domain 侧，放 `src/meals/conversation/`）

三餐对话今天整个跑在 briefer 的对话机器上：

- `info/briefer/info-durable.ts`：`MealsOrigin`、`asMealsOrigin`、key `meals:meals`、地址 `{ key: MEALS_BOOK_ID, threadId: MEALS_THREAD_ID }`、`conversationPlace`（watch 计数、`infoAssemblies`）、`mealsPlace`、`prepareInfoTurn`（UI 发三餐回合也走它）。拆成 `meals/conversation/durable.ts`，出 `mealsPlace` 和 `prepareMealsTurn`。
- `info/briefer/info-turn.ts`：`assembleInfoTurn` 的三餐分支（`bindItemTools(INFO_MEALS_KIND, mealsTools)`、`bindItemRef` 的 draft/fresh），box origin `{ place: "meals" }`。
- `info/briefer/deliver.ts` 185 行往后：`layMealsTurn`、`openMealsDelivery`、`registerMealsDelivery` → `meals/conversation/deliver.ts`。
- `info/briefer/role.ts`：三餐回合用的是 `secretary` 角色，duty 讲的是「陪用户过每日简报」并让模型 delegate 给 tasking。删 Intel 后要给三餐一个自己的角色（短 duty：帮用户规划和做三餐，工具只在用户要求时用，诚实、用用户的语言）。tasking 随 Intel 删，三餐就没有「派出去查」了，`tests/reading/turn/meals-think.test.ts` 和 `tests/meals/writable-replay.test.ts` 里 "the tasking worker" 那组跟着删。这一条要在最后报告里写明。
- `todayLocal` 在 `info/collect/store.ts`（就是 `localDateString(new Date())`），`ui/components/meals/use-meals.ts` 和 deliver 在用，搬进 meals。
- `reading/turn/info-bell.ts`：简报和三餐两种 bell，只留三餐那半（改名如 `meals-bell.ts`），`tests/reading/turn/info-bell.test.ts` 同步。
- 注册点：`ui/components/common/useBackgroundServices.ts:107`（`info: infoPlace(), meals: mealsPlace()`，留 meals），`useShellBootstrap.ts`（`registerMealsDelivery`、`registerSecretaryRole`、`registerInfoDelivery`，以及 46-71 行、264-311 行那批 info 注册）。
- 盘上的值不能变：thread 文件 key `info-meals`、thread id `meals`、对话 key `meals:meals`、box origin `{ place: "meals" }`、telemetry caller `meals-chat`。
- i18n：`info.anchor.meals*` 和三餐代码里其余的 `t("info.…")` 键搬进 meals 目录，9 种语言一起（`grep -rn 't("info\.' src/meals src/ui/components/meals`）。

### B. 三餐 UI 的宿主

- `ui/components/info/InfoHome.tsx` 托着三餐所有屏（`isMealsScreen`、MealsHome/Day/Recipe/Shopping/Method/Onboarding/Prep、手机首页三餐 tile、返回），`use-info-call.ts`（758 行）+ `InfoCall.tsx` 是三餐用的对话面板，`InfoCards.tsx` 把 `MealsDraftCard`/`MealsPrepCard` 注册进卡片表。
- 在 `ui/components/meals/` 里做三餐自己的宿主、`use-meals-call.ts`、`MealsCall.tsx` 和卡片注册，其余随 C 删。
- 入口：`AppSidebar.tsx`（桌面侧栏 Intel 那格换成 Meals）、`PhoneHome.tsx` + `phone/home-intel.ts`（手机首页 Intel 那格换成 Meals）、`base/places.ts`、`base/shell-nav.ts`（`HomeScreen` 的 `meals*` 屏、`reachableScreen`）、`phone/nav-stack.ts`、`App.tsx`、`PhoneApp.tsx`。Meals 开关关着就不显示入口。

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
