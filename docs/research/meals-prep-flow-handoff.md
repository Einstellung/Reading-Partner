# 备餐流程交接（meals-prep-flow-2 分支）

## 做完的

- 839d95bd：备餐页（docs/671「备餐页」第 1、2、4、5、6、7 段）、状态机 `src/info/meals/screen/batch-cook.ts`、Meals 页顶部卡片、手机首页 Meals 磁贴、`meals-prep` 导航、Apply 后进备餐页、`planner.preppedAt`。
- 64cb5c88 复查修了三处：计划里没有下一顿时磁贴写「Plan the next batch cook」却点进 Meals 页，改成开规划对话；Meals 状态还没读到时点磁贴没反应，改成进 Meals 页；`preppedAt` 不是数字时不算做完。
- 135f48c1、0eeb05ac 测试：`tests/info/meals/screen/batch-cook.test.ts`、`prep-view.test.ts`、`tests/info/meals/prep-done.test.ts`、`phone-nav-stack.test.ts` 里的 openPrep、渲染测试 `tests/ui/components/info/meals/meals-batch-cook.test.tsx`。共用夹具 `tests/info/meals/screen/batch-cook-fixture.ts`（第 1 天下午做、前一天下午做、前一天晚上做三种）。Apply 去向抽成 `appliedAction`（batch-cook.ts）和 `leaveForAppliedPlan`（use-info-call.ts），行为不变。
- 6d137ea2 文档：671 备餐页加状态，73 首页那段，ui/22 磁贴那段。

## 还剩的

截图拍了一批，只看了首页（磁贴在首屏下面，没拍到）和备餐页上半截。脚本在 scratchpad 的 `meals-prep-2/`：`make-fixture.ts`（按今天生成 noplan/prep/done/next/exhausted/nobox 六个夹具）、`shoot.ts`（无头 Chrome，xvfb-run 下跑，自己 kill 自己开的 Chrome）、`vite.private.mjs`（端口 1474）。设置里语言键是 `aiLanguage`。

1. `shoot.ts` 里首页几张改成 `full: true` 或滚到磁贴再拍。
2. 看 `shots/` 下其余图：`meals-card-prep-full`、`meals-card-next-full`、`prep-page-nobox-full`、`prep-page-zh-full`，备餐页下半截（分装、收进冰箱、早餐和晚上）。有问题改了再拍一次。

## 要知道的

- 英文界面下配料名是中文（「去皮鸡腿肉」），采购单和收纳文字也一样，是原有做法，本分支没动。
- 规划器出的菜没有旧的 `WeekPlan.pots`，做法页不写取盒热透。原有问题，没动。
- 真机没验。
