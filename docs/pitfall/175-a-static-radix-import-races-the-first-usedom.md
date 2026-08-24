# 静态 import 一个 Radix 原语，就和第一个 useDom() 抢跑

## 现象

`tests/ui/components/forward-ref-contract.test.ts` 从来没红过，把它挪到 `tests/` 根目录（`chore/mirror-test-tree` 干的事，因为它的 subject 是整个 `src/ui/components/ui/`）之后，21 个**别的**文件在模块作用域死掉，报的都是 `tests/support/dom.ts` 那句 "react-dom was evaluated before the first useDom()"。实测那棵树：`Ran 3435 tests` 而不是 3584，67 fail 里 21 个是 load 崩，170 个测试根本没跑。挪动本身一个字节的逻辑都没改。

## 原因

react-dom 在模块求值时算一次 `canUseDOM`（坑 121），`tests/support/dom.ts` 的守卫就是为这个立的：第一次 `useDom()` 时如果 react-dom 已经在 require cache 里，说明它是在没有 window 的时候求的值，特性检测永久错，于是抛错而不是继续跑。守卫是对的，代价是**谁先跑变成了判据**：一个静态 import 传递地拉进 react-dom 客户端 bundle 的测试文件，跑在第一个 `useDom()` 之后无事发生，跑在之前就打死这一轮里每一个 `useDom()` 文件。而文件顺序由文件系统枚举决定，不可移植（同一个 commit 的 worktree 和 clone 就不一样），根目录的文件先跑。

哪些 import 真的拉进那个 bundle，实测（probe：动态 import 一个 specifier，再在 require cache 里找 `node_modules/react-dom/cjs/react-dom.development.js`）：

| 拉进来 | 不拉 |
|---|---|
| alert-dialog、checkbox、collapsible、dialog、dropdown-menu、label、select、separator、switch、tabs、toast（16 个原语里的 11 个） | badge、button、input、overlay、textarea |
| `@testing-library/react` | `@radix-ui/react-slot`、`react-dom/server` |

要 portal 的那些 Radix 包才 import react-dom；`react-slot` 只 import react。`react-dom/server` 是另一个 bundle，里面没有 `canUseDOM`，所以全库那些 `renderToStaticMarkup` 的测试碰不到这件事——`dom.ts` 的 `REACT_DOM_BUNDLE` 正则也只认客户端那两个文件名。

## 解法

那个文件顶部 `await useDom()`，16 个原语和 Slot 都改成 `await import(...)`。静态 import 在文件里任何 top-level await 之前求值，把 import 行往下挪没用（坑 121 已经写过 bun 先求值 node_modules 依赖这一层），只有动态 import 排得到 window 后面。Slot 自己是干净的，一起改是为了让规矩只有一条：这个文件不静态 import 任何 UI 侧的东西。

断言一行没动。当前树上这个改动是等价的：逐文件求和 3561、单进程 3587，改前改后逐字相同，三个单跑就红的文件还是那三个，默认序仍是 3586 pass / 1 skip / 0 fail。mirror 那棵树上 67 fail / 3435 ran → 46 fail / 3584 ran，21 个 load 崩清零，剩下的 46 个 `(fail)` 名单改前改后完全一致（那是另一件事，`mock.module` 的抽签）。

## 为什么不加静态检查

精确的规矩是"测试文件不许静态 import 任何传递地求值 react-dom 客户端 bundle 的东西"，要做传递闭包分析，而且答案会随 Radix 换版本变。

退而求其次的"不许静态 import `src/ui/components/ui/*` 或 `@radix-ui/*`"今天命中 5 个文件，只有这一个是真的：另外四个（cardDispatch、intent-chips、retell-card 只 import `Button`，overlay-z import `overlay.tsx` 加 `react-dom/server`）按上表全在"不拉"那一列，逼它们 `useDom()` 是加戏。下一个是谁，由 CI 的 `bun test --seed=$RANDOM` 概率性地抓——守卫的报错信息自己就写着该怎么改。

## 顺带

bun 把模块作用域死掉的文件记成 `Ran 1 test`，不是 0。所以"逐文件隔离跑求和 == 单进程总数"这条判据在这一类失败上是灵的（单进程里 21 个文件的 170 个测试没跑，总数对不上），但求和那一侧每个崩掉的文件还会贡献 1，别拿差值直接当"少跑了多少个测试"。
