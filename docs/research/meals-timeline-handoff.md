# 备餐时间线交接（A1：排程、步骤、进度）

分支 `meals-timeline-core`，设计见 docs/info/671「菜品图」末段、「时间线与语音」「数据模型」。

## 做了什么

- `src/info/meals/timeline/steps.ts`：步骤 `PrepStep { id, text, device, pot, active, wait, after }`，设备是厨具或 `counter`（案板），`pot` 是锅的 batch id、`rice` 或 null。`readPrepSteps` 校验模型回复，一步不合格整份退回：设备不在厨具里、锅不是这次的、分钟不在 0..240 或两项都是 0、`after` 指向不存在的步或成环、哪口锅一步都没有、超过 40 步。`renumber` 按首次排出的顺序把 id 改成 "1".."n"，语音按这个编号叫。最后那步（分装或收冰箱）由程序加，id `pack`，10 分钟动手，等所有步。
- `timeline/schedule.ts`：纯排程。一双手，动手段不重叠；设备各一件，灶台按 `profile.burners`（缺省 2），蒸锅占灶眼；案板不限；等待段放手；就绪的步先排链最长的，平手按原顺序。输出每步的开始、动手结束、结束，按设备分的泳道和段，合并顺序，总分钟和动手分钟。`estimateMinutes` 用同一个排程器按每锅一步估分钟。
- `timeline/run.ts`：进度。`reschedule(steps, kitchen, run, event, at)` 处理 `started`、`done`、`more`（缺省 5 分钟）。动手超时不自动算完，后面顺延；等待段到点算完；`more` 能把已到点的等待段重新打开；开始某步时它等的步全部算完，手上另一件动手的事算结束。做完的步再报事件返回 `applied: false`。
- `timeline/view.ts`：`timelineView` 给 A2（泳道、合并步骤列表带状态、开始以后的钟点、当前步、下一步、剩余分钟和剩余动手分钟）；`sayNext`、`sayNow`、`sayLeft`、`sayDue` 给 B，句子在 `meals.timeline.*`，九种语言。`timelineMinutes` 是写好步骤以后的权威分钟。
- `recipe/prep-steps.ts`：每次备餐一个请求（锅、吃法、解好的克数乘人数、这次煮的米饭、厨具、灶眼数、语言），键 `prepStepsKey`；`writePrepSteps` 一次调用，回复不合格抛错不存。`recipe-live.ts` 的 `writePrepStepsOnce` 和做法页共用在途去重；`storedPrepSteps` 读已存的。后台扫描 `recipe-sweep.ts` 把这次备餐排在各顿做法之前，失败退避照做法页。
- 存储：步骤在 `info-meals-recipes.json` 的 `recipes` 表里，条目 `kind: "prep"`（`recipe-store.ts` 的 `loadPrepSteps`、`savePrepSteps`，旧客户端读到会跳过）。进度在 `WeekPlan.planner.prepRun`，`plan/store.ts` 读到不合格的只丢这一项。
- `src/info/meals/prep-progress.ts`：`startPrep(ports, key)`（同一份步骤已在跑就沿用，不重置钟）、`recordPrepEvent(ports, timeline, event)`（按开始以来的整分钟写事件）。不加 `revision`。
- 分钟：`planner/prep.ts` 的 `prepMinutes` 改成排程器估算，同设备的两锅不再重叠。`screen/batch-cook.ts` 的 `planPrep`、`batchCookEntry` 和 `screen/prep-view.ts` 的 `prepView` 多一个可选参数 `written`，传 `timelineMinutes` 就用它。草稿卡（`build-draft-card.ts`）没有档案，按 2 个灶眼估。

共享文件只动了 `src/info/meals/live.ts` 两行（import 和 `write` 分派）；`apply.ts`、`tools.ts`、`MealsPage.tsx`、`InfoHome.tsx` 没动。

## 还剩什么

A2（界面）：

- 备餐页和入口读已存步骤：`prepStepsRequest` 算出请求，`storedPrepSteps` 读，没有就 `writePrepStepsOnce`（chat 档）并显示「步骤在写」；拿到以后把 `timelineMinutes(steps, kitchenFor(profile))` 作为 `written` 传给 `batchCookEntry`、`prepView`，日卡的备餐行和手机磁贴同理。
- 第 3 段：泳道总览和步骤列表画 `timelineView` 的结果，`boxes` 取档案是否装盒；开始以后每分钟重读一次。
- 「开始备餐」按钮调 `startPrep`，点步骤或按钮发 `recordPrepEvent`；顶栏开始以后加预计结束钟点（`endsAt`）。
- 进度写在 `info-meals.json`，整文件后写者赢，两台设备同时点会丢一边；要不要单独存另议。

B（语音）：

- 三餐对话工具 `start_prep`，前台工具 `prep_step`（转 `recordPrepEvent`）、`prep_say`（`sayNext`/`sayNow`/`sayLeft`，走 `read_out`）。
- 等待段到点的提醒：比对前后两次 `timelineView` 里状态从 waiting 变 done 的步，念 `sayDue`。
- `meals-prep` 卡片和 `patchPart`、通话期间常亮、挂断后「接回语音」。

## 关键决定

- 步骤 id 在入库时按排程顺序重编号，开始以后不再变，语音和卡片都用这个编号。
- 进度只存事件（分钟），状态和钟点读时算；运行中的 `key` 和当前步骤键不同就当没开始（`runFor`）。
- 没说做完的动手步，过了计划时间仍算没做完，排在当前分钟以后。
