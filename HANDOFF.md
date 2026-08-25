# 排练闭环：讲稿回喂 + 老师傅

分支从 `b7dc40a4` 起，两个 commit：工具搬家（纯移动）、闭环（行为）。未 push。

`./scripts/t.sh` exit=0，3865 pass / 0 fail；`bun run typecheck` 两个 tsc 都过。

## 一、工具搬到哪

`src/reading/retell/arrange.ts` → `src/reading/talk/tools.ts`（`git mv` 保历史），卡片类型
`TalkArrangementCardData` 从 `retell/cards.ts` 拆到 `src/reading/talk/cards.ts`，`retell/cards.ts`
只留 `RetellDecisionCardData` 并把前者透传进 `ReadingCard` 联合类型（组件那边的 import 不用动）。

`isArranging` 没跟着走：它要 `RetellChapter` / `RetellPlan` / `nextChapter`，跟去 talk 就成环。留在
`src/reading/retell/plan.ts`（`nextChapter` 就在那），对应的单测挪进 `tests/reading/retell/plan.test.ts`。
`ARRANGE_INSTRUCTIONS` 按要求留在 `retell/prompt.ts`。

依赖方向由 `tests/layering.test.ts` 验：`reading/talk` 不 import 任何领域，`reading/retell` 和
`reading/rehearsal` 都 import 它，图无环。另外发现 `reading/retell` → `reading/rehearsal` 这条边已经存在
（`retell/store.ts` 删 retell 时要删它的 rehearsal），所以 **rehearsal 不能 import retell**——下面「老师傅看不见书」
那条决定就是这么来的。

## 二、讲稿怎么进对话

`finishRun`（`src/ui/components/rehearsal/rehearsal.ts`）多了一个可选的 `handoff(run, saved)`，在
`save` 成功之后调用，失败只 warn 不影响这一遍算不算数。`RehearsalView` 传的是
`handOffPass()`（`src/ui/components/rehearsal/coach-thread.ts`）：拿 `passMessage()`
（`src/reading/rehearsal/handoff.ts`）生成一条 **user** 消息 append 进对话。

消息里写清了：第几遍、多长、多少字、**这一遍给了哪几段（编号 + 标题 + 段 id）、没给的不用提**，然后每段一块逐字稿，
没说话的段标 `(I said nothing on this one.)`。整段话开头声明「这是识别器听到的，同音字错了不是我说错」，免得老师傅去挑转写错误。
一个字都没录到的一遍返回空串，不进对话。

`onSaved` 的签名改成 `onSaved(recorded: boolean)`：没录到东西时也要通知调用方，否则「正在等最后一段转写」的提示会永远挂着。

## 三、对话锚在哪

锚在**大纲**上，不是排练对象、也不是某一遍。thread key 是 `talk-<outlineId>`
（`talkThreadKey`，`src/reading/talk/store.ts`），thread id 就是 outlineId，和 retell 那套一样的形状。
文件名 `threads-talk-<id>.json` 已经落在 `platform/sync` 的 `threads-*.json` 里，同步和三方合并都不用改。

一条对话贯穿这个大纲的所有排练：第二遍交讲稿时，第一遍的讲稿和聊出来的东西都还在 history 里。

## 四、老师傅

`src/reading/rehearsal/coach.ts`（`COACH_INSTRUCTIONS` + 系统提示词组装）、
`coach-turn.ts`（`buildCoachTurn`，挂那五个写大纲的工具 + 一节 history-trim 的预算梯子）。

prompt 的要点：

- 姿态写死了和 retell 的区别：retell 里 AI 手上有书、逐章考；这里读者已经讲完了，AI 是听报告的老师傅，
  不复述、不逐段打分、不考书。
- 两个判据都在：① 判据不是「我懂了吗」——懂行的人会自动补上没说的那句然后觉得讲清楚了，判据是
  `spine.audience` 写着的那个人到这儿会不会掉队；② 听得出对方是在背一段正确的话还是真的懂了，
  给了三个可听的痕迹（教科书腔、只出现一次再没用过的术语、下了定义却从没拿它做过事），
  判定是背的就问一个能定性的问题。
- 只点评这一遍讲过的段；跳过的段和沉默的段都不算失败。
- 一次只说两三件，最坏的先说，不写评分不写小标题。
- 产物是对大纲的一次修改。**status 只有老师傅能从 shallow 抬成 ready**，而且只对「这次亲耳听到并且讲得住」的段；
  没听到的段不许标 ready。
- 不许把段改写成 AI 自己的话——那等于又把「正确的解释」还回去了。

排练当中一个字不出声：`RehearsalView` 里没有任何 AI 调用，交卷之后才在对话界面说话。

## 五、界面怎么走

- 关掉排练面板 = 交卷，直接落到老师傅对话（`CoachView`，`src/ui/components/rehearsal/CoachView.tsx`）。
  两个入口都接了：topic 的 Rehearsal 区（`LibraryScreen`）和 retell 头部的 Rehearse（`RetellView`，盖在 retell 上）。
- 这一遍还在等最后一段转写时，对话顶上有一行「Getting the last of what you said back from the recogniser…」；
  落盘之后 `passKey` +1，hook 重读 thread 看到未回答的 user 消息，自动跑一轮。
- 不给一遍也能进对话：Rehearsal 区每行多了个「How it went」。

## 六、先这样定的（讲过一遍再改）

1. **老师傅看不见书**。`reading/retell` 已经 import 了 `reading/rehearsal`，所以 rehearsal 不能反过来 import
   retell 去拿 materials，coach turn 就没挂 `read_pages` / `search_topic`。prompt 里仍然写「你读过这本书」，
   靠模型自己的底子。要给它书：在 ui 层（`useCoach`）把 `LoadedMaterial` 读出来当数据传进
   `buildCoachTurn`，turn 里挂 `buildReadingTools`——ui 层 import retell 不成环。约十几行。
2. **不写 observation**。retell 退出会 `distillRetell`；老师傅这条什么都不蒸馏。讲不出来的段本来是
   `cannot-explain` 最好的来源，但「一遍讲稿该蒸出什么」没定，没自己定。
3. **交卷之后是否自动跑一轮**：现在是自动跑（thread 末尾是未回答的 user 消息就跑）。没配 provider 时消息照样留在
   对话里，下次打开再答。
4. **`onSaved(recorded)`**：为了关掉「正在等转写」的提示才加的布尔，改签名影响两个调用点。
5. **对话界面没有第二栏**（没有大纲面板）：刚讲完的人盯着大纲看了一整遍，改大纲说一句话就行。
6. **卡片沿用 `talk-arrangement`**：老师傅写大纲和 retell 编排用同一张卡、同一个渲染组件。
7. **「How it went」的措辞和位置**是随手定的。

## 七、没做的

- docs 没动。`docs/43` 缺口里「讲稿还没回喂给对话」「反馈形态没定」两条现在实际上已经消掉，`docs/44` 缺口里
  「AI 改大纲的工具没有」也已经有了——这轮没去改设计文档（同会话还有别的 agent 在动 docs，怕冲突）。
- 没碰 `src/reading/slides/`、`import-deck.ts`、宿主桥、`isDeckPath`、`build.ts` 的切段、`talk/types.ts` 的字段。
- 老师傅这条路没有真机/真模型跑过：没有 provider key，只有单测。第一次真讲一遍之后大概率要调 prompt 的话量和
  status 的写入时机。
