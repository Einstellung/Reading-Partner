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
