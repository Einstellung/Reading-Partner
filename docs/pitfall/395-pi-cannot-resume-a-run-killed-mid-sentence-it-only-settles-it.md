# pi 不能从「被打断的 assistant 请求」接着跑，只会把它结算成一条 error 消息

## 现象

坑 394 修完（进程一起来就开 session、恢复真的跑了）之后，被杀那轮仍然什么都没落进线程文件。模拟器里把 webview 的 console 接出来看，只有一行：

```
an interrupted turn could not be finished
Error: Assistant request was interrupted. The preceding content is the latest committed
partial; newer live output may be missing and the external outcome is unknown.
```

而且这一轮 `[stall] recovery longest silence 19ms`——resume 根本没发出请求就结束了。

## 原因

`recover.ts` 的设计（docs/71）写的是「pi 写下被打断那个工具的合成结果，模型从那儿接着跑」。这只覆盖**死在工具调用里**的情况。

死在正文中间（而一个回合绝大部分时间都在写正文，所以这才是常态）走的是 pi 的另一条路：`harness/runtime/drive/recovery.js` 的 `recoverAssistantGeneration` 把已经 commit 的帧拼成一条 assistant 消息，塞上 `stopReason: "error"` 和那句 warning，然后 `publishResponse`。`drive` 见到 `stopReason === "error"` 就把整个 run 结算成失败。没有第二次请求，没有「接着写」。

我们这边 `turn.ts` 把它如实报成 `onError(errorMessage)`，`recover.ts` 的 `catch` 打一行 warn 就 `return`——于是**那条刚刚被 commit 上去的正文谁也没去读**。

## 解法

那句 error 不是「这个回合没救了」，它就是这个回合，写到哪算哪。而且结算这一下把正文从「只有帧」变成了「分支上一条 assistant message entry」——resume 之前读不到，之后读得到。

所以 `src/soul/recover.ts` 里：`send` 抛了就**重新 `inspect` 一次 lane**，拿结算之后的 transcript 走 `saidBefore`，落的就是完整的半篇回复。走通的那条路（死在工具里）照旧用 resume 之前的快照加上 resume 自己说的话，不能用新快照——新快照里已经包含 resume 说的，会重一遍。两条路都落不出字（连 message_start 都没来得及）就什么都不落，也不放 card。

这条路只落已经写出来的字，不重新问一遍。前台那条路（坑 390）反过来是重问：那边字还在屏幕上、问题还在线程里，重问换一条完整回复；这边进程已经死了，能拿回来的只有盘上这些。

`docs/pitfall/README.md` 顶部那张对照表里「回合中途切走 app」那一行同时指向 390 / 391 / 394 / 395。

测试：`tests/soul/recover.test.ts` 的「a turn interrupted mid-sentence lands what the resume settled onto the branch」和「killed before it said anything lands nothing at all」。

关联坑：390、391、394。
