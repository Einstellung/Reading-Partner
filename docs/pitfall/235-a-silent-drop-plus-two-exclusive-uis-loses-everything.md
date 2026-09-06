# 235 写入静默丢弃，加上两个互斥的界面只有一个建记录，等于整条路白跑

## 现象

info 的语音通话，整场对话一句都不落盘。看不出任何异常：驱动跑完了，转写口调用了，`appendMessage` 也调用了，没有报错也没有日志。而在文字聊天开过的那一天再打一次电话，同一份代码又全写进去了。

## 原因

两半各自都说得通，凑在一起才丢东西。

一半是存储：`appendMessage` 对不存在的线程返回 `undefined` 就结束，不报错也不新建（`patchThreadMessage` 同样）。这是别的调用方要的契约。

另一半是界面：球和文字聊天在 `InfoHome` 里互斥（`{!info.infoCall && <VoiceOrbEntry …>}`），而建线程的只有文字聊天那条路（`use-info-call.ts` 的 `createThread`）。语音那条路只 `loadThreads`，从不建。于是「今天没开过文字聊天」——也就是直接点球说话的常态——线程根本不存在，每一条 `record` 都被静默扔掉。

## 解法

建记录的责任放在会写它的那一侧，不要下沉进 store：语音通话在 `threadTranscript` 的 `begin()` 里，第一条 `record` 之前，按文字聊天同样的 id 和 `"info"` 锚建线程（`src/info/companion/voice-call-live.ts`）。store 保持原样——返回 `undefined` 是它的契约，改成自动新建会动到所有调用方。

判据：一个写入口静默丢弃时，先问"谁负责先把记录建出来"，再看那个负责人是不是在所有入口都会跑到。互斥的两个界面就是两个入口。
