# 印记之后先是整段对话历史，恢复把上一回合的回答当成这一回合的回复落盘

## 现象

三餐对话已有一轮回答，再问一句，first-byte 之后、正文出来之前杀进程。重开后恢复回合 6ms 结束（「Assistant request was interrupted…」），对话文件末尾多出一条 ai 消息，正文和上一回合的回答一字不差。死在工具里的回合也一样：落盘的是「上一回合的回答 + 这一回合的话」。

## 原因

`saidBefore`（`src/soul/recover.ts`）认为最新的 `reading-partner.delivery` 印记之后全是这一回合写的。可回合的 prompt 是对话至今的全部消息（docs/71），accept 时逐条写成分支上的 entry，排在印记和这一回合自己的输出之间，里面就有前几轮的 assistant 回答。坑 391、395 的测试 prompt 只有一条 user 消息，没碰到。main 上同样如此，不是分道引入的。

## 解法

`turn.ts` 盖印之后紧跟一条 `reading-partner.prompt` 自定义 entry，记 prompt 的消息条数；`saidBefore` 跳过印记后这么多条 message，再收 assistant 文字。steer 进来的 user 消息在这之后，前面那几轮照样算。没有这条 entry 的旧分支从最后一条 user 消息往后读：被 steer 过的回合会丢 steer 之前的话，但不会把旧回答再落一遍。

测试：`tests/soul/recover-settled.test.ts`（两种 lane 上的死在请求里 / 死在工具里，加 `saidBefore` 的两条）。

关联坑：391、395。
