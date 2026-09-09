# 探针里 `import("react")` 报错，app 自己 import 同一个 react 没事

## 现象

sim bridge 的探针（`drive.py` 把一段 JS 贴进页面 eval）里 `await import("react")` 直接抛，`await import("/src/reading/epub/EpubReaderPane.tsx")` 却好好的。换成 `import("react-dom/client")` 同样抛。

## 原因

裸模块名是 vite 的 `import-analysis` 在 transform 阶段改写的，改写只发生在 vite 服务的模块上。eval 进去的字符串没经过 transform，浏览器拿到裸名字自己解析，解析不了。

绕过去之后还有第二层：`/node_modules/.vite/deps/react-dom_client.js` 是 CJS 预打包的，`createRoot` 挂在 `default` 上而不是具名导出，解构出来是 `undefined`，报的是 `createRoot is not a function`，看着像版本不对。

## 解法

从 app 自己的模块里把 vite 改写后的 URL 抠出来，再按 URL import：

```js
const src = await (await fetch("/src/main.tsx")).text();
const url = /"(\/node_modules\/\.vite\/deps\/react\.js\?[^"]*)"/.exec(src)[1];
const React = (await import(url)).default ?? (await import(url));
const dom = await import(urlOf("react-dom_client.js"));
const createRoot = dom.createRoot ?? dom.default?.createRoot;
```

正则要写死 `deps/<文件名>`：`react.js` 里的点当通配符会先命中 `react_jsx-dev-runtime.js`。

这条是「探针要挂 React 组件」时才踩得到；探针只 import `/src/**` 的话一直没事。
