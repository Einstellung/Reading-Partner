# 337 sim bridge 的 eval 报错有时只剩一个 `@`

## 现象

2026-09-17 用 `scripts/sim-bridge.ts` 驱动桌面 app 截 README 用的图，脚本里一处 DOM 查找失败，回传的错误整个就是 `@`，后面跟一行 `eval code@…`，看不出到底是哪句、为什么。

## 原因

`scripts/sim-bridge.ts` 里 eval 出错时 `catch (e) { out = { ..., error: String((e && e.stack) || e) }; }`，把 `e.stack` 原样当错误内容送回来。WebKit 里一个没有自定义 message 的错误（比如访问 `undefined` 的属性触发的 `TypeError`）,`Error.stack` 不带消息那一行，只有调用栈，`String(stack)` 于是就是空消息后面跟着 `@` 开头的栈帧——看着像整条错误就是一个 `@`。

实测撞见的具体case：一张 figure 卡片按钮的 `innerText` 是以换行开头的，`indexOf("Fig. 5") === 0` 恒为 false，选择器判断走了 falsy 分支去访问一个不存在的属性，抛出的正是这种没消息的错误。

## 解法

不改 `scripts/sim-bridge.ts` 的错误传递逻辑（那不是一行改动，会影响所有调用方）。在自己写的 eval 脚本里，每处 DOM 查找和判断都自己加检查、自己 `throw new Error("说清楚的话")`：查不到就说查不到、断言不成立就说断言的是什么、实际值是什么。看到回传错误只有 `@` 时，先怀疑是脚本里某个选择器/断言没命中、抛出的是没带 message 的原生错误，别当成 sim bridge 本身坏了。
