# 540 关掉再开的对话停摆，撤回的插话写进文件两遍

## 现象

门口对话（faux，`tests/soul/door-reopen.test.ts`）：发问、插话、关掉（`detach()`）、再打开（`resume()` 接上同一回合），然后回合停摆。重问只发了一次，但被撤回的那句插话进了两次对话文件。

## 原因

`detach()` 后老 session 还跟着回合到结算，`resume()` 的新 session 也跟着，两边各在 `watchTurn` 里挂一个停摆看门狗。停摆时两只都 supersede，各自拿到撤回的 steer，`place-session.ts` 的 `settle` 在判断 `gone` 之前就 `deps.file(owed)`，两边都写。按停止不会这样：只有调 `stop()` 的那个拿到撤回的 steer。

## 解法

`place-session.ts` 按会话 key 记下被 detach 的回合；新 session 的 `resume()` 接上回合时叫它放手：`DrivenBookTurn.unwatch()` 撤掉老 session 的看门狗，结算时老 session 什么都不写。没人再打开时老 session 照旧看门、写文件。
