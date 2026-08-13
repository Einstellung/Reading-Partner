# 注册一次 DOM，整场测试从此都有 window

## 现象

给一个测试文件加 `GlobalRegistrator.register()`（`@happy-dom/global-registrator`），排在它后面的**每个**测试文件都能看到 `window` 和 `document`。两个文件就能验（bun 1.3.11）：

```
A module-eval, window= object
A test,        window= object
B module-eval, window= object     ← B 自己什么都没注册
B test,        window= object
```

这不是洁癖问题。这套代码有一批分支就是按"有没有 window"走的：

- `platform/app/host.ts` 的 `isTauri()`
- `platform/app/settings.ts` 的退出 flush（没 window 就不绑 pagehide）
- `platform/app/debounced-writer.ts`（没 window 就没有防抖、没有定时器、什么都不会自己写出去）
- `platform/app/external-link.ts` 从 `window.location` 读页面 origin
- `ui/components/ui/overlay.tsx` 在 `useLayoutEffect` 和 `useEffect` 之间二选一

全场有 window 等于把这些全部推到浏览器分支上。而 `tests/platform/settings-flush.test.ts` 和 `tests/ui/components/shell-bootstrap.test.ts` 正是为了不再假造 `globalThis.window` 才重写过的。

## 原因

`bun test` 全场只有一个进程，没有子进程（跑的时候 `pgrep -P` 全程 0 个孩子；坑 119 里说的 "worker" 是更早的 bun）。文件按顺序进同一个 `globalThis`，注册器写上去的属性没人拿下来。

好消息是顺序严格：bun 把一个文件跑完——包括它的 `afterAll`——才去求值下一个文件的模块作用域。实测：

```
A module-eval → A test → A afterAll（unregister）→ B module-eval → B test
```

## 解法

窗口谁要谁自己搭，跟着文件一起拆。`tests/support/dom.ts` 的 `useDom()` 注册窗口并同时注册一个 `afterAll` 卸掉它，于是 window 只在这一个文件的用例期间存在（怎么拿 `@testing-library/react` 见坑 121，那是同一个调用的另一半）。

```ts
import { useDom } from "../support/dom";
const { renderHook, render, fireEvent } = await useDom();
```

拆窗口走 `afterAll`，所以凡是要趁 DOM 还在时做的事（React 卸载、`cleanup()`）都得放 `afterEach`——`afterEach` 一定先跑。

`tests/dom-harness.test.tsx` 最后一个 `afterAll` 断言进程重新回到无 window 状态；它注册在 `useDom()` 之后，所以跑在卸载之后。这条一旦红，说明它后面每个文件都被塞了一个没要过的 window。

不用 `bunfig.toml` 的 `preload`：那是全场生效的，正好是要躲开的东西。

## 代价

进程里跑过一次真 DOM 之后，整场测试慢约 0.11s（3.19s → 3.30s，2377 个用例）。这笔钱是一次性的，不随 DOM 文件数量涨：1 个 DOM 文件 +0.11s，4 个 +0.14s。落在哪也量得出——排在 DOM 文件后面的最重的两个用例（`Markdown.stream.test.tsx`）各慢 40ms 左右，其余淹在噪声里。单独注册再注销、或者单独加载 `@testing-library/react` 都只有 +0.01s，两件事凑齐才有这个数。

happy-dom 立一个 window 约 115ms，jsdom 约 400ms（本机各跑三次）。
