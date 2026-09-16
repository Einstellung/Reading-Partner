# 重名的工具混过桌面组装，死在 harness 里

## 现象

v0.19.3 起 info 简报对话里发任何一句话都立刻红字失败：`Duplicate tool name: "statement_write"`。抛错的是 `node_modules/@earendil-works/pi-agent-core/dist/harness/config.js` 里的 `validateToolNames`，它在 `src/legion/execute/harness.ts` 组装工具清单时跑。没有哪一行代码指得出这两个同名工具分别是谁挂的。

## 原因

`statement_write` 被挂了两次：`src/soul/self.ts` 在每个 soul 回合都挂一份，`src/info/briefer/companion-tools.ts` 又在简报这个 desk item 上挂一份。

`assembleTurn`（`src/soul/turn.ts`）本来就有重名检查，但它只比角色的工具和 item 的工具，不比 soul 自己那套基础工具（statement、conversation、catalogue、observation、delegate）和 item 的。两份 `statement_write` 一份来自 soul 基础集、一份来自 item，正好落在检查的缝里，组装照过，到 harness 才炸。

## 解法

`statement_write` 只由 soul 挂，companion 工具集不再带 `statements` 选项。

`assembleTurn` 的检查改成走一遍最终清单：一个 name 到 owner 的 map，owner 是「soul 自己那套 / 某个角色 / 某个 desk item」，撞上就抛错并把两边都说出来。谁多挂了一份，错误信息当场指得出来。
