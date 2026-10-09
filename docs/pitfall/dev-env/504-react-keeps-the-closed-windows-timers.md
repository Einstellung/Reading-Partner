# react-dom 拿着第一个文件那扇窗的定时器，窗一关后面文件的组件就冻在第一帧

## 现象

`tests/ui/components/lumen/intake-card-render.test.tsx` 单跑全绿，排在 `tests/reading` 后面跑就红：每张卡都停在加载态，`findByText` 一秒超时。记录的读写全部完成，`watchIntake` 也调了 notify，`setLoaded(true)` 也调了，组件就是不再渲染。没有报错。哪些前置文件会触发看时机：`tests/reading/session` 里一半的 `use-*.test.tsx` 会，另一半不会。

## 原因

react-dom 和 scheduler 跟坑 121 一样，在模块求值时从全局取一次定时器：react-dom 的 `scheduleMicrotask = queueMicrotask`、`scheduleTimeout = setTimeout`，scheduler 的 `localSetTimeout`。`useDom()` 第一次 import 时 window 已注册，这些全局是 happy-dom 窗口的方法，而 happy-dom 的 `setTimeout` / `queueMicrotask` 在 `this.closed` 之后直接 return。第一个用 DOM 的文件在 afterAll 里关窗，此后整个进程的 React 拿的都是死定时器：scheduler 的延时任务不跑，react-dom 的微任务被丢。

致命的是 `useSyncExternalStore`：act 外的 store notify 走 `forceStoreRerender`，按 SyncLane 排一次渲染，冲刷靠那个微任务。微任务没了，渲染不来，而 root 记着「有一次 sync 渲染已排」，之后的更新都并进这一次，整棵树停在首帧。只有下一次 `act()` 退出之类顺手调 `flushSyncCallbacks` 的地方能救回来，所以红不红取决于前面留下了什么时机。

## 解法

`tests/support/dom.ts` 在模块求值时（窗口注册前）记下进程自己的 `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval` / `setImmediate` / `clearImmediate` / `queueMicrotask`；第一次 import `@testing-library/react` 时把它们临时放回 `globalThis`，import 完再换回窗口的。React 于是用活过所有窗口的定时器，canUseDOM 的判断照旧在窗口里做。

查这类「单跑绿、排后面红」的 DOM 测试：跑 `require("scheduler").unstable_scheduleCallback(NormalPriority, fn, { delay: 5 })`，延时任务不跑就是这个坑。
