# 子 agent 与上下文隔离

> 本文记录 `src/ai/subagent/` 的契约。上游是 [24](./24-联网搜索.md)（对话开始要去外面找东西）和 [02](./02-AI核心与memory设计.md)（memory 蒸馏是这个抽象的先例）。代码按 2026-07-30 的实现写。

---

## 问题

今天每个 AI 动作都发生在同一条对话的上下文里。让 AI "去查一下"，它读到的几十份摘要、抓回来的正文、试错的中间产物全部留在主上下文里，而上下文是这个应用的硬约束。

## 契约

子 agent 拿到自己的 message 列表（只有一条 user 消息，就是任务）、自己那一小组工具、自己的轮数上限，自己跑到底，只把一份 brief 交回来。它跑过的轮次活在调用方永远看不到的数组里，中间产物随运行结束一起消失。

签名层面（`src/ai/subagent/types.ts`）：定义是 `SubagentDefinition`（name / description / label / systemPrompt / tools / maxRounds / purpose / model / evidence / briefTokenCap），一次运行是 `runSubagent({definition, task, signal, onProgress}, {run, ledger})`，回来的是 `SubagentBrief`（brief / outcome / usable / rounds / roundsAllowed / toolCalls / toolSuccesses / toolFailures / clipped）。工具全部由调用方注入，这个目录不知道文献检索、简报和书的存在。

隔离不是靠约定，是靠没有出口：`turn.ts` 把 loop 的 `onDelta`、`onThinking`、`onToolStart`、`onToolEnd` 全部接到空函数上，只有 `onDone` 的最终文本能出来。

`model` 可以覆盖：跑机械查找的子 agent 用不着读者正在对话的那个模型。不加输出 schema，brief 是自由文本——机器要读的那几句状态由我们自己拼，模型写的那部分本来就是给模型读的散文。

## 诚实失败

主要的正确性要求是：子 agent 放弃了，绝不能以"什么都没找到"或者"一段没有出处的流畅回答"的形式到达读者。

六种结局各有自己的句子，都由 `brief.ts` 一处拼出，都以"这不是一个结论，不代表没有东西可找"结尾：轮数用光、共享预算已花完、上下文撑破窗口、每个工具都失败、loop 另有理由拒绝、调用本身失败。

工具挂了但模型照样写出答案，这份答案不返回——不裁剪、不引用、不加标签地丢掉，因为带标签的引文仍然是调用方可以转述的一段话。默认只要挂了工具就要求有证据（`evidence: "required"`），一次工具都没调就作答同样按无证据处理。部分工具失败时 brief 可用，末尾附一行说明哪个工具怎么失败的。

调用方只需要看 `usable` 一位。`tool.ts` 把不可用的运行 throw 出去而不是 return，和 `src/reading/papers/search-tool.ts` 一个规矩：模型会把 tool result 当答案读，"提前停了"就是这样变成"文献里没有"的。

## 预算与取消

每一轮的尺寸照常走 `src/budget`：轮次通过 `runAgentTurn` 的 `purpose` 交给 agent loop，loop 逐轮量、量不下就拒绝，和一次普通对话轮完全一样。回程也用它算：brief 按 `estimateTextTokens` 定价，超过 `briefTokenCap`（默认 1200 token，远低于 `OUTPUT_FLOOR.chat`）就截断并说明截断了——嵌套运行唯一能推爆调用方上下文的东西就是这段文本。

`src/budget` 表达不了的是"一次嵌套运行"。那个模块给一次组装好的调用定价，没有跨调用累计花费的概念，所以"这一整轮最多花 N 个模型轮次，嵌套运行从同一个池子里取"只能另记：`ledger.ts` 里一个计数器，`grant` 预留、`settle` 退还没花掉的。它拦住的是父模型连叫同一个子 agent 九次，每次单看都合法，加起来把读者这一轮全花在没人要求的查找上。

取消复用现有那条路：调用方自己的 `AbortController`，加 watchdog 的 `StoppedError`。agent loop 在 abort 时静默返回（不 `onDone` 不 `onError`），所以 `turn.ts` 的 abort 监听负责把它变成 reject。取消是唯一一种 reject 而不产出 brief 的结局——读者挂断之后的 brief 没有人要。

## 进度

调用方需要在跑的时候给读者显示一行，但不能拿到工具调用流。`SubagentProgress` 只带 phase、定义里那句 `label`、轮次计数，以及 phase 为 `"tool"` 时一个工具名——而且只是调用方自己注入过的名字。参数和结果永远不出现：子 agent 自己想出来的 query 是它自己的中间产物，结果正是这个模块要挡住的东西。

## 第一个调用方：文献检索

`src/reading/papers/research-agent.ts`。`search_papers`、`find_paper`、`walk_citations` 从读者那一轮上撤下来，变成这个子 agent 自己的工具集；对话上只剩 `research_literature(task)`，和一个仍然直挂的 `find_paper`（一条引文换一条记录，用不着委派）。提示词放在 reading 领域，不进 capability——怎么给一个读到一半的人查文献是领域知识。

brief 的形状写死在提示词里：最多五条，每条标题（作者、年份、venue）加链接或 DOI，加一句"这篇为什么答的是这个问题"。留在外面的是排序、候选数、来自哪个库、被引数、成段摘要、看过又放弃的论文。理由是 brief 就是读者从一次检索里看到的全部，而这些东西一条也用不上。`briefTokenCap` 压到 700，因为契约提示词的字数上限是从这个数推出来的，1200 会请回来一篇综述。

接线上三件事必须成立：`buildReadingTurn` 每个读者轮建一个 `SubagentLedger`（池子 10 轮）；轮的 `AbortSignal` 一路传到 `runSubagent`，读者挂断即杀；进度只用来改写聊天里那一行状态，不展开子 agent 的工具调用。`usable: false` 由 `subagentTool` throw 出来，在读者的 loop 里就是一次失败的工具调用。

## 第二个调用方：memory 蒸馏

`src/memory/distill.ts`。它比这个 capability 更早写，形状一样：一次静默运行、自己的 prompt、自己的工具、注入式的 runner，所有流式回调接空。现在长在 `runSubagent` 上。

`evidence: "optional"`，这是这里唯一一个用错默认值就有害的字段。挂了工具就默认 `"required"`，因为查找型子 agent 存在的前提是答案不在模型记忆里。蒸馏不是查找：prompt 明说浅对话可以什么都不记、一次工具都不调是正常结局，那么一次正确的空运行在 `"required"` 下就是 `no-evidence`，会被记成失败、时间戳永不推进，下一次触发再蒸馏同一份 transcript，无穷循环。

失败的处置：`DistillResult` 加 `ok` / `outcome` / `failure` 返回给调用方，不 throw——不完成有六种形状，靠 catch 分辨必错一种，而且半途失败已经写进磁盘的那几条计数仍然要交回去。调用方（`live.ts`）拿到 `ok: false` 就一行 warn 带上子 agent 自己那句话、一条 `distill-failed` 事件，两个时间戳原地不动，此外什么都不做：memory 记账在读者那边没有落点，弹窗说"蒸馏失败了"是拿读者没要求也无法处理的事去打断他。真正让下一次触发重做的是时间戳没动，所以时间戳纪律搬进了 `runDistillPass`，对着假 fs 单测。

brief 的文本只在失败时有用（那句诚实失败的句子进日志）。成功的运行按 prompt 以 "done" 结尾，产物是 memory 文件的写入，文本照旧丢掉——`briefTokenCap` 压到 200，是给"能交回来的东西"设个上限，不是因为要读它。

不给 ledger：ledger 拦的是父模型一轮里连叫同一个子 agent 九次，而蒸馏没有模型来调它，是 app 在挂断和历史裁剪时各起一次，同一 thread 一次只跑一个。

取消：两个触发点都没有能取消它的主人，`signal` 是通的但今天没人传。挂断（`captureHangup`）先起蒸馏再 abort 聊天轮的 controller，把那个 signal 交过去等于每次一起跑就被杀；裁剪兜底跑在读者那一轮里，那一轮的 signal 会被 Stop 和挂断 abort，而挂断正是最需要这次蒸馏跑完的时刻。一次 pass 必须活得比起它的那个东西久。

## 留给以后

轮数用光的运行现在什么都不带回来。loop 走 `REFUSE_ROUNDS` 出口时没有最终文本，那一轮读到的东西就地丢失。补法是补一次无工具的"现在收尾"turn，需要把运行的 message 列表交回来，这次不做。

蒸馏的 `signal` 等一个真正有资格取消它的调用方：删除对话时，一次正在给已经不存在的消息写 memory 的 pass 该停。

简报生成也还没挂上来。
