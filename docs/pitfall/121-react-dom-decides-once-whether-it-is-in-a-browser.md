# react-dom 只在模块求值那一刻判断自己在不在浏览器里，onChange 会静默失灵

## 现象

在 DOM 装好之后渲染一个受控 input，`onChange` 一次都不触发。组件正常渲染，`fireEvent.change` 正常改了值，effect 正常跑，handler 就是不进：

```tsx
const { getByLabelText } = render(<Field />);
fireEvent.change(getByLabelText("f"), { target: { value: "hi" } });
expect(seen).toEqual(["hi"]);   // 实得 []
```

没有报错，没有警告。

## 原因

`react-dom.development.js` 在模块作用域算一次：

```js
var canUseDOM = !!(typeof window !== 'undefined' && ...)
```

浏览器特性探测全从这个值派生——passive listener 支持、动画事件的厂商前缀名，以及 `isInputEventSupported`（决定 React 到底监不监听 `input`）。react-dom 求值时没有 window，这些就永久是 false，之后再把 DOM 装上也回不去：React 不再监听 `input`，受控 input 的 `onChange` 从此不响。

于是顺序变成硬要求：window 必须比 react-dom 的模块求值早。而**调 import 顺序没用**——bun 先求值一个文件的 node_modules 依赖，再求值它的本地依赖。把注册 DOM 的本地模块写在 `@testing-library/react` 上面照样输：

```
REG done, window= object     ← 本地模块确实先打印
(fail) onChange              ← react-dom 还是先求值的
```

`react-dom/server` 是另一个 bundle，里面没有这段，所以全项目那些 `renderToStaticMarkup` 的测试不会提前污染。

## 解法

唯一可靠地排在 window 之后的是动态 import。`tests/support/dom.ts` 的 `useDom()` 先注册窗口，再 `await import("@testing-library/react")`，把拿到的东西返回：要 DOM 和要工具是同一个调用，没有顺序可以搞错。

```ts
import { useDom } from "../support/dom";
const { renderHook, render, fireEvent } = await useDom();
```

`react` 本身照常静态 import，它对 DOM 没有意见。

真有人写了静态 `import { render } from "@testing-library/react"`，`useDom()` 会在第一次调用时查 `require.cache` 里有没有 `react-dom/cjs/react-dom.development.js`，有就抛错说明原因——把一个静默失灵换成一句话。`tests/dom-harness.test.tsx` 里那条 onChange 用例是正面的那半：它一旦红，就是这个坑又回来了。

## 同一句话的另一半：应用模块也只求值一次

react-dom 不特殊，只是后果最吓人。任何在模块作用域读 `window` 的模块都是求值那一刻定终身，而 `bun test` 全场一个进程（坑 120），所以**哪个文件先 import 它，它就按那个文件当时的环境定下来**——一个挂了 DOM 的测试文件动态 import 到 `src/App.tsx`，App 那一整棵树就是在有 window 的情况下求值的，后面每个 headless 文件拿到的都是那份。

所以规矩是反过来的：应用模块尽量**静态** import（排在 `useDom()` 之前，环境和今天一样），只有真的必须在窗口之后求值的才动态 import——渲染进 document 的那些（`src/App.tsx`、`src/PhoneApp.tsx`、chat 那几个组件），它们的依赖图里有 react-dom，静态 import 会撞上上面那个守卫。

改完拿 junit 报告按用例 diff 一次前后（`bun test --reporter=junit --reporter-outfile=…`）：加 DOM 那三个文件时是 0 个用例状态变化，这个说法才成立。
