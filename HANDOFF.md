# 排练：对着大纲讲

做完了。`./scripts/t.sh` 3826 pass / 0 fail，`bun run typecheck` 无输出。

## 改了什么

数据层（`src/reading/rehearsal/`）：

- `types.ts`：`RehearsalRunEntry` 去掉 `pagesTotal` / `pagesSpoken`，换成 `segmentIds` / `spokenSegmentIds`（段 id 数组，按首次到达的顺序）。`normalizeRunEntry` 只认这两个字段，旧 deck 时代的 entry 读出来是两个空数组——靠容忍，`REHEARSAL_VERSION` 和 `RUN_LOG_VERSION` 都没动。`RehearsalPage.kind` 现在装段 id，注释写明了。
- `summary.ts`：加 `segmentIdOf` / `coverageOf`；`RunSummary` 的 `pagesTotal` / `pagesSpoken` 换成 `segments` / `segmentsSpoken`。
- `build.ts` 一个字没动。`BuiltRun.deckFile` 保留（永远是 null），因为动它就要动 build.ts。

界面（`src/ui/components/rehearsal/`）：

- 新 `outline-run.ts`：按钮发什么事件、Next 走到哪、回扣指向谁、公式怎么围栏、一屏放不放得下。全是纯函数，单测在 `tests/ui/components/rehearsal-outline.test.ts`。
- `RehearsalView.tsx` 换掉 iframe，改成大纲面板：主线一行常驻（极小）→ 序号+标题（中）→ cues（最大）→ material → callback（最小最淡）→ 底部「Next: 下一条标题」+ Next 按钮。段区 `overflow-hidden` 不滚动，超了在顶上出一条 amber 提示。顶栏多一个 Segments 按钮，展开右侧折叠段列表，点一条就跳过去并收起。
- `rehearsal.ts`：`rehearsalReadiness` 的闸从「有没有 deck」换成「大纲有几段」；`FinishRunInput.deckFile` 变成可选。deck 的 postMessage 那半（`readDeckSignal` / `checkDeckProtocol` / `withSlideEvent`）原地冻结，头注释写明了理由。
- `useRehearsal.ts`：删掉 `useRetellDeckFile` 和 `useDeckHtml`，加 `useRetellOutline`（给 Rehearse 按钮的闸用）和 `useTalkOutline`（给面板用）。
- `RehearsalScreen.tsx` / `RetellView.tsx`：两个门都改成先把大纲读出来再挂面板，`deckFile` prop 删了。RetellView 里 `deckKey` 一并删掉，DeckDialog 关闭只 `setDeckOpen(false)`。

## 事件那条路

按钮 → `withSegmentEvent(events, segment, index, Date.now())` → `{ kind:"slide", at, index: 段在大纲里的位置, slideKind: 段 id, title: 段标题 }` 进 `eventsRef`，和 deck 报翻页时的形状一模一样。是「换段」才 `transcript.cut()`（跳到正在讲的那段不算换段），和原来 `isPageTurn` 的判据一致。落盘走原来的 `finishRun` → `buildRun` → `appendRun`，一行没改。

`tests/ui/components/rehearsal-outline.test.ts` 最后两个用例把这条路端到端跑了一遍：按钮事件 + utterance 进 `buildRun`，出来的 entry 的 `segmentIds` 对得上，跳段和同一段讲两遍都验了。

## run 记录和旧数据

新形状：`segmentIds` 记覆盖了哪几段，`spokenSegmentIds` 记其中说了话的。抠一段讲五遍就是五条 run，每条 `segmentIds` 长度是 1。`ordinal` 保留（它只是「这个排练对象的第几条记录」这个标签，不再承担「第几遍讲完」的意思）。

旧数据：deck 时代的 `rehearsal-<id>.json` 没有 `outlineId`，`normalizeRehearsal` 读出来就是 null，所以那些排练根本不进列表，它们的 runs 文件也不会被打开或改写。真被读到也只是两个空数组，不报错不迁移。`runs-rehearsal-<id>.json` 的 records 合并按 run id 走，只增删了 entry 里的字段，`recordShape` 不用动。

## 已知缺口

- `{kind:"figure"}` 有 `figId` 时，只在 `FigureContext` 能解出这个 id 时才画真图（也就是这台设备上正开着那本书）。否则退回显示 `description` 加一个 `Fig. N` 标签。原因：大纲的 figure 只有 figId 没有 bookId，多本书的 retell 里「figure 3」是歧义的（`src/reading/retell/turn.ts:130` 记了这件事），猜一本书画出来可能是别人的图 3，比不画更糟。要补的话得先给 `TalkMaterial` 的 figure 加 bookId，那是 docs/44「段的字段细度没定」那条。
- 一屏放不放得下是估算，不量 DOM：`outline-run.ts` 里 `CUE_COLUMNS=40` / `SCREEN_LINES=14`，中日韩字算两列。讲过几次之后按实际观感调这两个常数。
- 老师傅那一轮（角色 prompt、反馈、改大纲的工具）没做，按任务书说的留给下一轮。
- 没开过任何 GUI 窗口。面板的渲染用 `renderToStaticMarkup` 静态断言（`tests/ui/components/rehearsal-panel.test.tsx`），没跑真浏览器。

## 容易撞车的地方

`src/ui/components/retell/RetellView.tsx` 动了 5 处（import、`rehearse()` 的守卫、readiness、`<RehearsalView>` 的 prop、DeckDialog 的 onClose）。retell-rename 那个 agent 如果也在改这个文件，合并时看这几处。
