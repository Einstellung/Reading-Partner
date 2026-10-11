# `__fauxCalls` 把启动时的蒸馏也算进去，「重启后模型调用 0 次」会误判

## 现象

复述正文中 SIGKILL 后重开，`window.__fauxCalls` 是 1，看起来像被杀的回合重问了一次。线程文件里却只有半句一次，turn-log 里那条复述回合是 `end aborted`，多出来的那次调用是 `surface: "subagent"`、没有 conversation。三餐和门口同样的操作是 0。

## 原因

慢速 faux 替换的是整个 anthropic provider 的 `stream`，不只回合。启动后 memory 的蒸馏扫一遍各个 source unit（`src/memory/live/live.ts`），复述里有读者新说的话就跑 `distillRetell`，它也走这个 provider。三餐不蒸馏，所以没有这次调用。

## 解法

判「重启后不重问」看 turn-log：被杀的那个对话（`conversation` 字段）重启后没有新的 `start`；或者看 `window.__fauxContexts` 里每次调用发出去的消息。不要只看 `__fauxCalls`。
