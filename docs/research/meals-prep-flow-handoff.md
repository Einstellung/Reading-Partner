# 备餐流程交接（meals-prep-flow 分支）

## 做完的（839d95bd）

- 备餐页：docs/671「备餐页」第 1、2、4、5、6、7 节。推导在 `src/info/meals/screen/prep-view.ts`，渲染在 `src/ui/components/info/meals/MealsPrep.tsx`。第 3 节时间线和语音没做，页面里留了注释。
- 「做完了」只写一个字段 `planner.preppedAt`（`plan/types.ts`），由 `apply.ts` 的 `markPrepDone` 存。备餐日已过也算做完。
- 状态机 `src/info/meals/screen/batch-cook.ts`：setup / plan / prep / next / planNext，给 Meals 页顶部卡片（`MealsBatchCook.tsx`）和手机首页 Meals 磁贴各出一份文案和点按去向。备餐那天的日卡上方多一行「备餐 · 下午 · 动手 N 分 · 共 M 分」。
- 导航：手机栈加 `meals-prep`（带 session，`nav-stack.ts` 的 `openPrep`，返回到 Meals 页）；桌面/iPad 在 InfoHome 里用本地 state 记 session。
- Apply（卡片按钮和 apply_meal_plan 工具都走 `use-info-call.ts` 的 handleApplyMealsDraft）之后进备餐页，手机上挂断对话（有 pip 的形态缩进 pip）；没有备餐 session 时落到 Meals 页。
- 9 种语言的 meals/phone/info 文案去掉「本周」说法：删 planThisWeek、planNextWeek、weekRunsOut、nothingPlanned、askWeek、restOfWeek、phone.home.mealsWeek/mealsFoot，加 meals.entry.*、meals.prep.*、askPlan、restOfPlan，info.ask.aboutThisWeek 改名 aboutPlan。
- `prepMinutes`、`mealAtSession` 从 `build-draft-card.ts` 挪到 `planner/prep.ts`，否则 screen/ 和 info/meals 成环（layering 测试）。
- 已有测试跟着改：`meals-plan-note.test.tsx`、`phone-home-render.test.tsx`（加了磁贴文案、点按、加载占位三条）、`build-draft-card.test.ts` 的 import。typecheck 退出码 0，`scripts/t.sh` 8886 过 0 挂，退出码 0。

## 还剩的

1. 单测：`tests/info/meals/screen/batch-cook.test.ts`（各状态、nextMeal 按小时、entryCardView/entryTileView、prepRowText）和 `prep-view.test.ts`（锅、备料分组、容器、分装、放哪、晚上和早餐、session 不符返回 null、done）。造状态照 `tests/info/meals/planner/prep-day.test.ts`：fillDraft → weekFromDraft，用 card-fixture 的 LIB、checked 和 PROFILE 做 charter。另补 `markPrepDone`、`openPrep` 的测试。
2. 渲染测试：BatchCookCard 各状态、MealsPrep（有 view、missing、done 三种）。
3. 文档：docs/info/671 状态写明备餐页哪几节已做；docs/info/73 第 84 行附近的旧入口描述；docs/ui/22-手机形态.md 首页 Meals 磁贴那段。
4. 截图：393x852，`?shell=phone` 假数据，xvfb-run 无头 Chrome。脚本从 phone-home-final 抄（make-fixture.ts、shoot.ts、vite.private.mjs），fixture 要有一份带备餐 session 的已存计划。要拍：首页磁贴 plan/prep/next/planNext、Meals 页带卡片、备餐页。一次拍完。

## 要知道的

- 规划器出的菜没有旧的 `WeekPlan.pots`（RecipePot），所以做法页对这些餐还不写「取盒加热」。这是原有问题，本分支没动。
- MealsPage 里 `hour` 可选，测试可以传；不传用本机时钟。
- 真机没验。
