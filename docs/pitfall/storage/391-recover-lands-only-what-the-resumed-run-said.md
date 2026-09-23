# 进程被杀后 resume 出来的回复只有结尾一段，死前写下的几轮正文丢在 session 里

## 现象

用户线程里第 43 条 AI 消息只剩一句收尾（「这一处到此立住了。顺便说一句……」），正文没有。同一条消息的 trace 里四个工具全跑完了，observation 里还记着模型承认过「逐渐下降是移动平均」——那段话确实说过，就是没落进线程文件。

## 原因

`src/soul/recover.ts` 在进程启动时把上一份 session 里还开着的 run resume 掉，拿 `runAgentTurn` 的 `turnText` 当回复落盘。`turnText` 是 `joinRoundTexts([...written, text])`，而 `written` 只收**这一次调用**里 `after_response` 看见的那些轮。

被杀前那几轮的正文早就 commit 进 session 了（每轮调工具之前模型都写了一两句）。resume 起来的 run 不会重发它们——它只接着往下说。于是落盘的就只有最后一轮的字。

这就是 `recover.ts` 头部注释和坑 367 里那句「死前已流出的文字不重发」的尾巴。

## 解法

resume 之前先从 `previous.inspect(lane)` 的 transcript 里把这一轮已经说过的话读出来（`saidBefore`），拼在 resume 的结果前面再 `landReply`。

扫描从这一轮自己的 `reading-partner.delivery` 印记往后——lane 上每个回合都是 session root 的一条分支，accept 之前先盖印，所以最新那个印记之后的都属于这一轮，之前的都不属于。只取 assistant 消息里的 text：工具结果是喂回模型的，从来不是回复的一部分。

不花额外 token：这些字本来就在盘上。

测试：`tests/soul/recover.test.ts` 的两条（死前说过话 / 死前一个字没说）。

关联坑：390（没被杀、只是冻住的那条路）、308、367。
