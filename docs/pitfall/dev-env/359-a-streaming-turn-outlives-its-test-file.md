# 359 一个测试留下的流式回合会跨文件活到下一个测试

## 现象

`tests/reading/session/use-call-thinking.test.tsx` 和 `use-call-hangup.test.tsx` 单跑全绿，一起跑第二个开始 `runAgentTurn` 一次都没被调用，`send()` 像没发生过。谁先跑谁过。

## 原因

`readingTurns()` 是模块级单例（`src/reading/live-turns.ts` 顶部就写着为什么：回合要活得比 React 树长）。测试里为了观察回合中途的行为，`runAgentTurn` 被 mock 成一个永不 resolve 的 Promise——于是那条线程上的 live turn 永远不结算，留在注册表里。下一个测试文件用同一个 `threadId`（都是 `"t1"`）挂载 hook，`send` 看见这条线程上有回合在跑，就按 docs/72 走 steer，不再起新回合。

在这条规则进来之前 `start()` 只是 abort 掉旧的再覆盖，所以这个泄漏一直存在但没有症状。

## 解法

留下流式回合的测试文件自己收拾：

```ts
import { resetReadingTurns } from "../../../src/reading/live-turns";
afterEach(cleanup);
afterEach(resetReadingTurns);
```

`tests/reading/session/use-call-*.tsx` 六个文件都加了。判据是「这个文件会不会调 `send`」，不是「它测不测 steer」。
