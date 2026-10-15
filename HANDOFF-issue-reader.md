# 交接：简报书阅读器模式（88 拆片 ④ 前半）

分支 `worktree-agent-a739186518f05c647`。代码在 8cf0ee5b，文档和本文件在其后一个 commit。`scripts/t.sh` 全绿（7604 pass / 0 fail），`bun run typecheck` 0 错。

## 做了的

- 模式判定 `src/reading/issue.ts`：`readerModeOf`、附注 `issueTurnNote`、划线 `issueHighlights`、引文定页 `pageOfQuote`。
- 桌面项 `src/reading/issue-desk.ts`（kind `issue`，`registerReadingDesk` 里登记）：≤12k token 内联全文带 `[p.N]` 锚，挂 `read_pages`、`search_topic`、`read_supplement`；无 history/memory/origin。
- `soul/door.ts` 的 `openDoorTurn` 和 `soul/door-chat.ts` 的 `prepareDoorTurn` 加 `desk?: DeskRef[]`；门口桌上的项带 history 就抛错。
- `src/ui/components/lumen/issue-context.ts`：开着的简报（`publishOpenIssue` / `useOpenIssue`）、Ask 通道（`askLumen` / `subscribeAskLumen`）、`opensDoor`、`issueDoorTurn`、`noteOnLastLine`、`doorCitationJump`。
- `use-door-chat.ts`：装配时取 `issueDoorTurn`，附注接在发给模型的那行；`send(text, quote?)`；`openedFor` 触发 `info/issue/opening.ts` 的 `speakIssueOpening`（空实现，下一片填）。
- `DoorChat.tsx`：输入框上方引文条（`shell.door.dropQuote`，9 语言）；开着简报时自带 `CitationContext`/`QuoteCheckContext`，点页码收起对话窗并跳页标引文。
- `LumenCorner.tsx`：简报发布即开门口对话（key 含 issue，重挂载）；Ask 打开今天的对话并挂引文；`!shown` 时只渲染对话窗。
- `MessageList.tsx`：用户行开头的 `> 引文\n\n` 画成引文块。
- 桌面/iPad `App.tsx`：`readerMode` 状态、`publishOpenIssue`、触摸选区 Ask 走 `askLumen`、`ReaderTopBar mode` 隐藏 Learn 与 AI 笔（`rackOmits(touch, mode)`）。
- 手机 `PhoneApp.tsx`/`PhoneReader.tsx`/`PhoneReaderBar.tsx`：简报盒项用 `openBook` 目标直接开阅读器（topicId、path 为空，`closePhoneBook` 跳过 markOpened）；`noLearn`；选区和标注弹窗的 Ask 走 `askLumen`；发布开着的简报，跳页用 `jumpInBook`。
- 测试：`tests/reading/issue.test.ts`、`tests/reading/issue-desk.test.ts`、`tests/soul/door-issue.test.ts`（门口回合装配：history 是门口线程、材料是这本书、附注只在发给模型的那行）、`tests/ui/components/lumen/issue-context.test.ts`、`tests/ui/components/chat/quoted-question.test.ts`。
- 文档：88「简报书的实现」、68「Lumen 作为入口」相应段已改。

## 还剩的

1. 无头截图没做：390×844（coarse）和 1180×820 下打开 `/tmp/claude-1000/-home-xinyuan-Documents-Github-Reading-Partner/15019a09-1392-4bd7-b849-9f737409aa40/scratchpad/sample-brief-rich.epub`（库条目 `kind: "issue"`、无主题），截：没有 Learn 的阅读器、对话窗跟着出来、选中后 Ask 进门口对话（引文条 + 发出后的引文块）。做法照坑 624 的内存 fs，脚本参考同 scratchpad 下 `lumen-impl/`；截图放 `.../scratchpad/issue-reader-impl/`。模型用假 provider。只用 headless/xvfb-run，记 PID 只杀自己的。
2. 桌面鼠标没有选区 Ask（桌面问书本来靠 AI 笔，简报里 AI 笔去掉了），鼠标用户在简报里只能 Highlight 或直接在门口打字。要不要给鼠标选区加 Ask 待定。
3. 简报里打开辅助资料时，门口点页码跳的是屏上的文档（`jump` 用当前 view），没区分「简报的页」和「辅助资料的页」。

## 关键决定

- 新开 `issue` 桌面项而不是让 book 项改读 `env.thread`：book 项 858 行全是线程、课堂、prep 的装配，简报用不上。
- 引文存成用户消息正文里的一行 Markdown 引文，不改线程文件结构；引文所在页在装配时用全文定位，不另存。
- 附注列这期全部划线（标注没有时间戳），最多 12 条。
