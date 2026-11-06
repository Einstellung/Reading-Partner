# 687 housekeeper：AI 写入与护栏

2026-11-06 定。AI 改用户数据不再一个场景开一个写工具：模型拿到一份数据的副本，在 `run_code` 的沙盒（[686](../soul/686-只读代码沙盒.md)）里写程序把副本改成要的样子交回，程序比对改前改后，过护栏，通过就落盘，不通过把原因退回让模型重改。能改什么由模型自己的能力决定。这套写入归 housekeeper：它从「夜里清理」（[80](./80-回收：retention、garbage marker 与 housekeeper.md)）扩为管宫里东西的人，何时扔、AI 怎么改都归它。这一轮只做写；读照旧（见「读」）。

起因是三餐对话里两次改数据失败：10-31「我有 600 克鸡胸、400 克牛腱，照这个改菜单」，没有工具能改一锅的生重；11-06「手撕鸡改成鸡丁炒锅焖、不用压力锅」，`write_meals_method` 只能改已存计划一顿的一行，碰不到未保存的草稿和备餐。两次都 delegate 给 tasking worker，它只有读工具，什么都没改成。

## 登记

两边各登记一半，通用工具只放行两边对得上的 kind。

palace 总表（`src/palace/kinds.ts`）每行加一个纯数据字段 `ai?: { write?: true }`，表示这个 kind 允许 AI 通过 housekeeper 改。palace 是 platform 层，这个字段不引用任何函数。

领域在启动时（`bootDomains`，和 `registerGarbageMarker` 一个做法）按 kind 名 `registerWritable(entry)` 进 `src/housekeeper/write/`。entry 的字段：

| 字段 | 内容 |
|---|---|
| `kind` | palace 行的 kind 名，该行必须带 `ai.write` |
| `open(id)` | 读出这份数据交给沙盒的副本（一个可 JSON 序列化的值）和它的 `base`（读到的文件文本的 hash）；`id` 给一个 kind 多份数据的情形，单文件 kind 传 null。数据不存在时返回 null |
| `shape` | 一段 TypeScript 声明，描述副本的结构，每个字段注明是输入、程序算的（从哪个输入算）还是锁定的。沙盒里给模型看 |
| `parse(value)` | 护栏 1：交回的值能否读成这个 kind 的合法结构，不能就返回原因 |
| `computed` | 护栏 2：程序算的字段，路径模式（`plan.days.*.*.solved`）加一句「要改它就改哪个输入」 |
| `locked` | 护栏 2：谁都不写的字段，路径模式（id、时间戳、界面进度） |
| `check(before, after, ctx)` | 护栏 3：领域约束，返回问题列表，每条一句模型能照着改的英文，带字段路径 |
| `gate(before, after)` | 护栏 4：这次改动要不要用户点头，返回 null 或 `replace` / `delete` / `send` |
| `land(before, after, ctx)` | 重算程序算的字段，经领域自己的 store 落盘，触发下游（重写做法、刷新卡片、通知界面）；返回给模型的几行说明和回执 |
| `restore?(beforeText, ctx)` | 撤销时把旧文本写回；缺省时按旧文本 `parse` 后走 `land` |
| `describe(before, after)` | 改了什么，按用户的说法一行一条，用于回执、确认卡和版本记录 |

守卫测试 `tests/housekeeper/write-guard.test.ts`：带 `ai.write` 的行在启动登记后都有 entry，有 entry 的 kind 在 palace 里都带 `ai.write`；这些行的 `sync` 不能是 `remote-only`。

## 模型看到的接口

两个工具，描述都是固定文字（durable 按名字从进程级目录注册工具，见 686），在 `ui/components/common/durable-catalog.ts` 登记一次。

`edit_data({ kind, id?, code, why })`：`code` 是 async 函数体，在 686 的同一个沙盒里跑（同一个 QuickJS Worker、同样的时间、调用次数和内存上限）。沙盒里有：

- `data`：`open` 给的副本，可以随便改。
- `SHAPE`：entry 的 `shape` 文字。
- `tools.<名字>`、`text()`、`console.log()`、`ALL_TOOLS`：和 `run_code` 完全一样，只能调这一回合的读工具。
- `return` 交回改好的值（改过的 `data` 或一个新对象）。不 `return` 就是只看不改，什么都不写，只回打印的内容；先打印 `data` 的一部分看清结构再改，就是这样用。

`why` 是一行，用用户的话说为什么改（「按手头 600 克鸡胸重算」），进回执和版本记录。

结果：通过的回改动列表（`describe`）、`land` 的说明和版本号，并要求不要复述数据；被护栏挡下的回「什么都没写」加每条问题和它的路径，模型改了程序再调；要确认的回「已出卡等用户确认，还没写」。kind 不认识或这一回合没有它时，报错里列出能改的 kind 和各自的 `about`。soul 的 catalogue（`soul/catalogue.ts`）给带 `ai.write` 且已登记的行标「可用 edit_data 改」。

`undo_edit({ kind, id? })`：撤销这份数据最近一次还没撤销的写入，见「上一版与撤销」。

两个工具都是 `effect: "write"`，没有 `replay`：进程死在写入中途，恢复时模型拿到「被中断」，再调 `edit_data` 只看不改就能知道写没写成。

## 一次写入怎么走

1. `open` 取副本和 `base`。
2. 副本以 JSON 字面量放在程序第一行前（同一行，行号不变）定义 `data`，在沙盒里跑模型的程序，拿回 `return` 的值。程序出错照 686 的格式退回。
3. 拿交回的值和副本逐路径比对，得出改动的路径集合。没有改动就只回打印内容。
4. 护栏 1：`parse`。护栏 2：改动路径命中 `computed` 或 `locked` 的，逐条退回，`computed` 的带上「改哪个输入」。护栏 3：`check`。任何一条不过就整份退回，什么都不写。
5. 护栏 4：`gate` 不为 null 的，转「确认」。
6. 落盘前重读文件，hash 和 `base` 不同（这期间同步或别的回合改了它）就退回「数据刚变了，重新 open」。
7. 写版本记录（护栏 5），再 `land`。`land` 里重算失败就不落盘、退回原因，版本记录随之删掉。

## 护栏

五类，前两类由 housekeeper 按 entry 的声明通用执行，后三类的判断归领域：

1. 形状：改完仍是合法格式（`parse`）。
2. 程序算的字段不许写（`computed`、`locked`）。模型改输入，`land` 重算。副本里带着算好的字段，让模型看得到克数、营养这些结果，改了才退回。
3. 领域约束（`check`）：领域现有的检查直接接进来，不另写一套。
4. 要用户点头的动作（`gate`）：删除、整份替换、对外发送。
5. 每次写留上一版，用户说「改回去」就撤。

## 确认

`gate` 返回非 null 时不落盘，housekeeper 把这次改动存成一条待确认记录 `housekeeper-pending/<id>.json`（`kind`、`id`、`base`、交回的值、`describe` 的几行、发起者、时间），出一张通用确认卡（聊天卡片 kind `housekeeper-confirm`，画在 `ui/components/chat`），卡上是 `describe` 的几行和「确认」「不要」。点确认时从第 6 步接着走：文件已经不是 `base` 就提示「数据变了」，卡片作废；点不要就删记录。待确认记录同步（`data`），七天后由通用 `age` 规则回收。

卡片出在发起者所在的对话：soul 回合出在它自己的线程；worker 没有卡片通道，待确认记录随它的交回（delivery）落到派它的那个对话，在那里出卡。

现有的卡片闸照旧：三餐草稿卡的「就这样」和 `apply_meal_plan` 仍是整份替换计划的那道确认，`edit_data` 不做「应用草稿」。

## 上一版与撤销

每次落盘前，housekeeper 写一条版本记录 `housekeeper-versions/<kind>/<writeId>.json`：`writeId`（时间在前、按名字排序就是先后）、`kind`、`id`、时间、设备、发起者（线程、run）、`why`、改前的整份文件文本、改后文本的 hash、`undoes`（撤销记录才有）。每条只写一次不再改，同步走 `data`，合并策略 `opaque`（不会有两份内容）。palace 行 retention `keep-last` 每个 kind 目录 20 条，按名字。三餐的 `info-meals.json` 现在约 100 KB，20 条约 2 MB。

`undo_edit` 找这份数据最近一条还没被撤销的非撤销记录，要求当前文件文本的 hash 等于它记的改后 hash；不等说明之后又有别的改动，拒绝，并把那之后的改动列给模型，让它用 `edit_data` 照用户的意思改。相等就用 `restore` 写回改前文本，自己也记一条带 `undoes` 的版本，所以连续撤销一步一步往前退。撤销也过护栏 4：撤掉一次整份替换本身就是整份替换，要出卡。

版本随同步走，所以 worker 在另一台设备上改的，用户在 iPad 上说「改回去」也撤得了。

## 同步

housekeeper 不自己写数据文件，`land` 和 `restore` 都经领域自己的 store，palace 行上的合并策略原样起作用。领域写 `land` 时要守住自己文件的合并规则：

- 整文件一个 lattice 的（`info-meals.json`，`plan/merge.ts` 按 `plan.createdAt` 取后确认的那份）：原地改不动 `createdAt`，只加 `revision`，和现有写工具一样；整份替换才盖新的 `createdAt`。撤销一次整份替换时，`restore` 把恢复回来的计划的 `createdAt` 盖成现在，不然同步会按旧时间戳让被替换掉的那份赢回来。
- 按 key 合并的（`info-meals-recipes.json`、`info-meals-photos.json`）：不登记成可写，它们是程序或后台调用按输入派生的，`land` 只负责让它们重算。

## 挂在哪

和 `run_code` 同两处，紧跟在它后面加，所以每个回合、每个 worker 都是同一套：

- `soul/turn.ts` 的 `assembleTurn`：工具清单定稿、`withCodemode` 之后加 `edit_data`、`undo_edit`，沙盒里能调的读工具就是这张桌子的全部读工具。桌子、角色、surface 都不用各自挂。
- `legion/subagent/run.ts` 的 `runSubagent`：在 `withCodemode` 之后加。tasking worker、语音的 `think`、回合内的子对话都走这里。

发起者信息（线程、run、place）和出卡的端口由这两处传给工具。

`soul/roles.ts` 的 `RoleWrite` 现在只是声明，运行时没人拦。经 housekeeper 的写入由它真的执行闸：`card` 就是护栏 4 的确认卡；`instruction` 是护栏通过即落盘，`why` 记下用户的那句话；`trial` 是落盘前先在副本上把重算跑通。旧写工具收编一个，就从角色的 `writes` 里删它一条，全部收编后 `RoleWrite` 删掉。

## 分层

housekeeper 是 capability，现在只 import platform 和 palace。写入放进子目录 `src/housekeeper/write/`，在 `tests/layering.test.ts` 的 LAYER 表登记为 capability。它 import `legion/codemode`（`runProgram`、`codemodeReach`）、`legion/durable` 的工具契约、palace、platform 和 i18n；不 import soul、`legion/subagent`、`legion/bell`、`legion/ledger` 和任何领域。被 soul、`legion/subagent`、`ui/components/common`（目录登记）和登记 entry 的领域 import。

查过现在的目录图：`legion/codemode` 能到的是 legion、`legion/durable`、ai、budget、i18n、`memory/usage`、platform，都到不了 housekeeper，所以 `housekeeper/write → legion/codemode` 不成环。`legion/bell` 和 `legion/ledger` 为登记 garbage marker import 了 housekeeper 的根；写入不放在根里、根的 `index.ts` 也不转出写入，legion 哪天要登记 marker 也不会经根绕到 codemode。housekeeper 根不 import `housekeeper/write`，`housekeeper/write` 也不需要根。

## 三餐：第一个登记者

目标：10-31 和 11-06 两件事一次改对，草稿和已存计划都能改，tasking worker 也能改。

现在 planner 计划的输入只有草稿：`WeekPlan.planner.draft`（`planner/draft.ts` 的 `PlanDraft`：每天午晚吃哪一锅的哪种吃法或现做哪道、配菜、水果、早餐，`batches` 一锅一行，`sessions` 备餐时段）和 `picks`。一锅的生重、做法、设备都不是存下来的输入：生重是 `solveDraft` 按蛋白目标解出来的（`to-week.ts` 里 `rawG = protein.grams * people`），做法和设备取菜库里那道菜的 `summary`、`equipment`，备餐步骤的请求（`recipe/prep-steps.ts`）也从菜库取。planner 计划没有 `WeekPlan.pots`，那是 docs/671 之前的周计划才有的字段。`write_meals_method` 写的是 `days[].<meal>.method`，下一次重算（`resolvePlannerWeek` 对做的那几顿整顿覆盖）就被盖掉。未保存的草稿只在聊天卡片的 payload 里，读工具和 worker 都读不到。

登记三个 kind：

`info-meals-draft`，新文件 `info-meals-draft.json`，存当前那一份未保存的草稿：`draftId`、`threadId`、`version`、`startDate`、`draft`、`picks`、`updatedAt`、`phase`。同步 `data`，lattice 合并取 `updatedAt` 晚的。`propose_meal_plan` 改为写这个文件，草稿卡从这个文件重建（`buildDraftCard`，带上一版标出改了哪顿），文件变了（本机写或同步拉到）就 patch 卡片、`version` 加一；「就这样」和 `apply_meal_plan` 从这个文件取草稿。可改：`startDate`（今天到六天后）、`draft`；`picks` 由程序跟着改（见下）；其余锁定。不出确认卡：草稿本来就等着确认。

`info-meals`，`info-meals.json`。可改：`plan.planner.draft`、各顿的 `note`。程序算：`plan.days` 里做的那几顿除 `note` 外的字段（`solved`、`items`、`name`、`method`、`minutes`）、`shopping.items`、`plan.planner.picks`。锁定：`plan.id`、`startDate`、`createdAt`、`revision`、`planner.start`、`preppedAt`、`prepRun`，以及这一步还由原工具负责的 `charter`、`shopping` 的读者那一半、`deviations`、`photosAskedAt`。`gate`：改动让计划覆盖的日期或备餐日吃哪几顿变了（天数、备餐日、备餐时段）算整份替换，计划变成 null 算删除；其余原地改。

`info-meals-dishes`，新文件 `info-meals-dishes.json`，用户自己的菜（docs/671「菜库」里说的 `origin: "user"` 的菜，`write_dish` 至今没做）。按菜 id 的 records 合并。`planLibrary` 读种子库加这个文件：菜库是同步读的，文件在内存里留一份（`dishes/user-dishes.ts`），启动时读，本机写入和 pull 到时换掉；`PlanLibrary.all()` 是建库用的全部菜，菜单列表和补草稿都从它取。用户的菜没有发布的菜图，走 `drawDishes`。只能新增和改自己的菜，id 不能和种子菜重；`writeUserDish` 是校验加写入的纯函数（存成 `origin: "user"`，改菜保留第一次的 `createdAt`），`removeUserDish` 删一道，删除要确认。

输入层新增一个字段：`DraftBatch.rawG?`，这一锅蛋白食材的总生重（全家，用户报的现成量）。`solveDraft` 有它时把这锅的蛋白固定在 `rawG / people`，吃这锅的几顿平分，主食、加餐照常补一天的热量，整包取整不再动它；超出这道菜的 `maxMainScale` 或低于参考份量乘顿数，就是一条 `pot` 问题。

`picks` 跟着改：`edit_data` 改了 `draft` 里某一锅的菜、`rawG` 或某顿的主菜、吃法，`land` 把同一位置的值写进 `picks`，其余不动，这样之后改档案触发的重新补草稿（`planner/redraft.ts`）不会把这次改动补没。

`check` 接现有检查：

- 草稿两个 kind：`checkDraft`（`planner/checks.ts`）。求解前的结构规则（菜认识且能排、锅和备餐时段对得上、冷藏天数 `fridge`、厨房有这口锅 `equipment`、`fruit_food` 等，`DraftRule` 里 `red_meat` 之前那些）挡下；求解后读计划的营养规则（红肉、豆类、全谷、蔬菜、钙、钠、蛋白、热量、整包剩余）不挡，落盘后在结果里点名，和 `apply_meal_plan` 现在的做法一样。
- 用户的菜：`checkDish`（`dishes/check.ts`）的入库检查全部挡下，由 `writeUserDish` 跑。

`land` 的重算：

- 草稿：`checkDraft` 出 `result`，重建并 patch 卡片。
- 已存计划原地改：照 `apply.ts` 的 `resolvedWeek` 走 planner 那支，`checkPlannerRecord`、`resolvePlannerWeek` 重解做的那几顿（只覆盖今天起的日子，过去的日子照存的留着，计划就是记录），`plannerShoppingList` 加 `reconcileShoppingList` 重出购物单、保留读者的勾和自己加的行，`revision` 加一，`ports.changed()`。做法页和备餐步骤按 key 存，菜或克数变了 key 就变，经 `live.ts` 现有的「本机写了这周」那条路由 `recipe-sweep.ts` 重写；新菜名的图片走 `drawDishes`、`startPhotoSearch`。
- 已存计划整份替换（确认后）：`weekFromDraft` 加 `freshShoppingList`，和 `applyDraft` 一样。

两件事按这套怎么改：10-31 那份是已存计划，一次 `edit_data({ kind: "info-meals" })`，程序把鸡肉那锅和牛肉那锅的 `rawG` 设成 600 和 400，重解后各顿克数、购物单、备餐步骤都跟着变。11-06 那份是未保存草稿，两次 `edit_data`：先在 `info-meals-dishes` 加一道菜，从 `salsa_shredded_chicken` 抄过来，改名、做法类别改焖（`braise`）、设备改灶台、做法概述和吃法名改成鸡丁，过入库检查；再在 `info-meals-draft` 把那一锅的 `dish` 换成它，过 `checkDraft`，卡片换成第二版。tasking worker 手上是同一套工具，调法相同。

两处提示词要改：三餐对话的说明（`tools.ts` `mealsGuidance`）删掉 `write_meals_method` 那句，改说改计划、草稿、菜用 `edit_data`；tasking worker 的定义（`info/tasking/tasking-agent.ts`）不再说三餐只读。

## 收编顺序

先三餐，跑通再接笔记、主题等，旧工具一个一个删，不一次搬完。

1. 三餐第一步（上一节）：`write_meals_method` 删掉。`propose_meal_plan`、`apply_meal_plan` 留着，前者改写草稿文件。
2. 三餐其余：购物单读者那一半（`add_shopping_items`、`remove_shopping_item`、`replace_shopping_item`）、`record_meals_deviation`、`update_meals_profile`（`patchProfile` 和 `cookingOilWords` 的校验成为 `check`），各自登记进 `info-meals` 的可改字段后删工具。
3. 其他领域：笔记、主题、保存的文章，按 kind 一个一个登记。

删一个旧写工具之前：它写的字段都已是对应 entry 的输入，它原来做的校验都在 `check` 里；它现有的测试用例改成对 `edit_data` 跑一遍并通过；提示词、`about`（如 `info-meals` 行说的「Read it with the meals_read_* tools」）和角色的 `writes` 里都不再提它。三餐那一步另加两条回放测试：用 10-31 和 11-06 当时的数据，脚本化地发出那两个改动，断言一次落盘、结果对。

## 读

这一轮读不动：领域的读工具照旧（如 `info/meals/read-tools.ts` 的六个 `meals_read_*`），`run_code` 照旧调它们，`edit_data` 的沙盒里也能调。写入建副本时可以用领域现有的读函数（`info/meals/read.ts`）。

以后读也收进 housekeeper：领域只登记一次自己的数据怎么打开，通用读工具和沙盒都从登记表走，不再按领域手写读工具。写入的登记为此留了位置：`open` 和 `shape` 就是「怎么打开、长什么样」，读那一期直接复用；palace 的标记是 `ai: { write }`，读那一期在同一个对象里加 `read`。

## 已知限制

- `info-meals.json` 是一个 lattice：两台设备在同一份计划上各改一次（比如 worker 在桌面改克数、用户在 iPad 勾了一行），同步时按 `plan.createdAt` 分不出先后，一份留下，另一份停成冲突副本，冲突副本没人处理（80「现状」）。现有三餐写工具也是这样。
- 撤销只撤最近一次之后没再变过的数据；中间有别的改动就拒绝。
- 备餐做到一半时改了这次备餐的锅，备餐步骤的 key 变了，`PrepRun.key` 对不上，进度不再显示（`plan/types.ts` `PrepRun` 的说明）。
- 用户的菜没有现成的菜图：发布的菜图按种子库的菜 id 命名（`photos/dish-art-ids.ts`），用户的菜要等 `drawDishes` 现画，供应商不能画图的设备上就没有图。
- 进程重启后恢复中的回合，desk resolver 重开出来的工具里没有 `edit_data`、`undo_edit`，和 686 的 `run_code` 一样，下一个正常组装的回合恢复。
- 沙盒在 Tauri 自定义 scheme 和 iOS WKWebView 下的 Worker 没有实测，同 686。
