# 漏出来的 window 让条件安装器什么也不装

## 现象

随机文件顺序下 `sanitizeArticleHtml` 对任何输入都返回 `""`，`tests/info/sanitize.test.ts` 和 saved-articles 一起红一片（另一棵树上 seed 2026 的 103 个 fail 里 31 个是这个）。默认顺序绿，单文件单跑也绿——这套代码平时用的两道检查都看不见它。

## 原因

三步，缺一不可：

1. 一个 `await useDom()` 的文件在模块作用域抛错（典型是 `mock.module` 换过导出的模块被动态 import，`Export named 'x' not found`，坑 119）。文件在模块作用域死掉就不跑自己的 `afterAll`，happy-dom 的 window 留在 `globalThis` 上。
2. `tests/support/dom-parser.ts` 第一次被求值正好落在这段时间里。它是 `if (typeof DOMParser === "undefined")` 才装，现在看见的是 happy-dom 的，于是什么也不装。模块只求值一次，这个决定就是终局。
3. 再往后某个 `useDom()` 文件跑完自己的 `afterAll`，把漏出来的 window 卸掉。`GlobalRegistrator.unregister()` 恢复的是 register 当时存下的属性描述符——当时 `DOMParser` 根本不在 `globalThis` 上，存的是 null，于是它 delete。从这里到进程结束都没有 DOMParser。

sanitize.ts 没有 DOMParser 就返回 `""`，所以后面每个走 sanitizer 的文件都红，而红的地方离出事的文件隔着几十个文件。

## 解法

装在 `tests/support/preload.ts` 里，无条件装，不看 `globalThis` 上已经有什么。happy-dom 的 registrator 会把它顶掉的描述符存下来、`unregister()` 时原样放回去（实测：漏窗口被卸掉之后 `typeof DOMParser` 仍是 `function`），所以在任何测试文件跑起来之前装一次就够了；`beforeEach` 里再补一道在这套代码上一次都不触发，量过才删的。`tests/support/dom-parser.ts` 连同四处 `import "../support/dom-parser"` 一起删掉——两个安装器就有两份意见。

这不违反坑 120。坑 120 不许全场立 window，是因为 `isTauri()`、settings 退出 flush、`debounced-writer`、`external-link`、`overlay.tsx` 都按"有没有 window"分支。`DOMParser` 不是任何分支的判据：`src/` 里读它的是 sanitize.ts 和 readable.ts 两处（不是一处，dom-parser.ts 原来的注释写错了），两处都是"没有就什么也做不了"，没有测试靠"环境里恰好没有"去验那条分支——唯一验它的用例自己 delete 自己放回去，readable.ts 只能从 `readable-lazy` 动态 import 进去，而到得了那里的测试都先立了真窗口。

jsdom 模块本身要 0.5s 才加载完，所以 preload 里装的是个 getter，第一次读 `DOMParser` 才 `require("jsdom")`，单文件跑仍是 0.03s。`typeof DOMParser` 会触发这个 getter，探"在不在"要用 `"DOMParser" in globalThis`。

## 复现

四个文件，按 leak → 取 sanitizer → `useDom()` → 再取 sanitizer 的顺序跑（顺序拿 `--seed` 摆，bun 不按命令行参数顺序跑文件）：第四个文件拿到 `""`。preload 装上之后同一个 seed 全绿。

顺带量出来的另一面：window 漏着、后面没人卸的那一段里，sanitizer 用的是 happy-dom 的 parser 而不是 jsdom 的，`tests/info/sanitize.test.ts` 38 个用例红 32 个。那是同一个漏窗口的另一张脸，preload 装的这一份盖不住它——真正治它的是别让文件在 `useDom()` 之后死在模块作用域。
