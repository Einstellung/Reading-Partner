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

## A2 做了什么（分支 `meals-timeline-ui`）

- `screen/prep-timeline.ts`：第 3 段的视图（阶段 before / running / finished、泳道条的百分比和刻度、每步的文字和能点什么、顶栏结束钟点）、`writtenMinutes`、「慢了」两档 `LATE_CHIPS`（5、10）、到下一整分钟的毫秒数。单测 `tests/info/meals/screen/prep-timeline.test.ts`，夹具 `prep-timeline-fixture.ts`。
- `ui/components/info/meals/use-prep-steps.ts`：`usePrepSteps`（算请求、读已存、`write` 为真时当场写，失败等重试）、`useRunClock`（跑着时一个定时器按整分钟走）、`useScreenWakeLock`、`useOnForeground`。
- `MealsTimeline.tsx` 画第 3 段；`MealsPrep.tsx` 接上步骤、计时、常亮和前台重读，打开时已在跑就滚到第 3 段；`MealsHeader` 加 `note`（标题下一行，放结束钟点）。
- `InfoHome.tsx` 调一次 `usePrepSteps`（只有在备餐页时才写），`written` 传给 Meals 页（卡片和日卡备餐行都走 `batchCookEntry`）和手机磁贴；开始走 `startPrep`，点步骤走 `recordPrepEvent`，前台回来 `meals.reload`。
- 文案九种语言（`meals.timeline.*`）。渲染测试 `tests/ui/components/info/meals/meals-timeline.test.tsx`（在写、失败、开始前、跑着、慢了、做完、常亮的拿和放、Meals 页分钟）。

截图脚本在 scratchpad 的 `meals-timeline/`：`make-fixture.ts`（今天下午备餐、按请求键存好步骤、无进度 / 在第 2 步 / 第 2 步超时三份）、`run-shots.sh`（起私有 vite、xvfb-run 下无头 Chrome、只杀自己起的进程）、`shots/`。

## B 做了什么（分支 `meals-prep-voice`）

- 前台：`soul/voice/front/cascade.ts` 加 `say(text)`，程序的句子排进念原文那条队，地板空了（没人在说）立刻念，不等 2 s，写进通话所属的对话；`attached`、`extraTools` 每轮现取，`context.ts` 把 `attached` 放进「所在地方」，单独封顶 1200 token。
- `soul/voice/live/call-host.ts`：设备上那一通电话的信号口。角上（`use-voice-call.ts`）登记成 host，别处用 `requestCall(builder)` 要一通指定的电话（已开着就沿用）；屏幕用 `attachToCall` 往任何开着的通话上挂地方文字和工具；`live/call.ts` 在通话非 idle 时登记 `openCall`，`sayInCall` 走前台的 `say`。
- `info/meals/prep-voice.ts`：步骤清单（编号、一句话、设备、状态，无钟点无分钟）、`prep_step`、`prep_say`、`start_prep`、到点比对 `dueSentence` 和整分钟一个定时器的 `createDuePrompter`（每次拿当前的 run 比上一刻和此刻，事件造成的变化不念）、卡片视图。`prep-session.ts`：开始和事件都经这里，写 run、换卡片；`startPrepFromChat` 给工具用（步骤没写就当场写）。
- `info/briefer/meals-call.ts`：三餐线程上的通话（`deliverTo: meals`、开场白不报步骤）和卡片落盘（同 id 原地 patch）。放 briefer 是因为线程 id 在 `anchors.ts`。
- 界面：`InfoHome` 用 `use-prep-voice.ts` 挂步骤和工具、通话开着时跑提醒、拿 `prep-call` 常亮；「开始备餐」在点按里先要通话再写 run；第 3 段在跑且没通话时显示「接回语音」，设备不能语音时一行说明。`wake-lock.ts` 加 `heldScreenWakeLock`，备餐页（`prep-run`）和通话共用一个 sentinel。卡片 `MealsPrepCard.tsx` 登记在 `InfoCards.tsx`。
- `tools.ts` 只动三行：import、`MealsToolDeps.startPrep?`、目录里加 `buildStartPrepTool`；只有用户所在的三餐对话（`use-info-call.ts`）传 `startPrep`，后台 run 拿到的工具答「这里不能开始」。
- 测试：`tests/soul/voice/front-say.test.ts`、`live/call-host.test.ts`、`tests/info/meals/prep-voice.test.ts`、`tests/ui/components/info/meals/meals-prep-voice.test.tsx`、`tests/platform/app/wake-lock-shared.test.ts`；`tool-contract.test.ts` 名单加 `start_prep`。截图脚本在 scratchpad 的 `meals-voice/`（`run-shots.sh`，无头 Chrome 跑在 xvfb-run 下；通话开着那张是在页面里调 `openCall` 假装开着）。

## 还剩什么

- 真机：出声、收音、前台模型会不会按说明调 `prep_step` / `prep_say`、不自己报钟点；WKWebView 里的常亮；提醒在 iPad 上的时机。
- 沿用门口那通电话时，句子仍写进门口的对话，不搬到三餐线程。
- 点「做完了」不挂断通话，只撤下步骤和工具、放掉通话那把常亮。
- 三餐对话开着时，卡片的更新只落盘，界面上那张要重开对话才变。
- 离开 info 屏（比如去读书）时步骤、工具和提醒随 `InfoHome` 卸下，通话还在。

## 关键决定

- 步骤状态在 `InfoHome` 读一份，备餐页、Meals 页和磁贴共用；`MealsPrep` 只拿状态和回调，测试不碰存储。
- 开始的那一下就拿常亮（Safari 要手势），开始没写成就放掉；点「做完了」或离开备餐页放掉。
- 「开始了」只出在下一步上，「做完了」和「慢了」出在在做和在等的步上；开始以后钟点刻度只标开始、中间一个整点和结束，免得挤。
- 做完了以后进度不删，页面按做完画（全部变淡、不能点、不计时）。

- 步骤 id 在入库时按排程顺序重编号，开始以后不再变，语音和卡片都用这个编号。
- 进度只存事件（分钟），状态和钟点读时算；运行中的 `key` 和当前步骤键不同就当没开始（`runFor`）。
- 没说做完的动手步，过了计划时间仍算没做完，排在当前分钟以后。
