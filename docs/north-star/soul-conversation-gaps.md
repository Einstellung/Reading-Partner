# soul 对话的尾巴

## 愿景

聊天可见性与 steer 的设计（[72](../soul/72-聊天的可见性与steer.md)）已经落地，soul 的存储层重命名（[71](../soul/71-soul.md)）也定了方向。本文收两边各自剩下、没人在催的几个具体缺口。

## 为什么现在不做

72 自己把这些列为尾巴，不是新设计要拍板；71 的 `threadId` 改名是确认过的重命名，不挡任何人用。

## 将来做时已知的事实

- steer 只接了书对话：`src/reading/session/use-call.ts` 引入了 `createSteering`，retell、简报/语音对话（info）都没有对应的接入。
- 图片不能随 steer 一起发；答铃（自己起的回合）不走流式；silent 回合结束但没有交出结果时不自动续跑。72 尾巴。
- Outline 刷新只认 `local` 档 run 的完成状态，`synced` 档的完成不认。
- `openThread` 读文件和 `callRef` 更新之间有竞态，偶尔少显示一条消息。
- 存储层的标识符 `threadId` 改名 `conversation` 没做：`src/soul/sequence.ts` 里的字段仍叫 `threadId`。[71](../soul/71-soul.md)。

## 待定

第一屏交互怎么设计，71 里还没拍板。
